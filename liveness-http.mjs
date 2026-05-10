// liveness-http.mjs — Lightweight HTTP-based liveness checker
//
// Purpose: verify job URLs are still active before Joe wastes time on gap analysis.
// Used by score-and-publish.mjs to check APPLY/REVIEW tier roles post-scoring.
//
// This is intentionally separate from check-liveness.mjs (Playwright-based, full-
// render classifier). This module is HTTP-only — faster, no browser, good enough
// for filtering out obviously dead listings (404/410/redirects/body signals).
//
// Exports:
//   checkLiveness(urls, { verbose, skipCache }) → Promise<{ results: Map<url, entry>, stats }>
//
// Entry shape: { result: 'live'|'stale'|'unknown', reason, ageDays, checkedAt }

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const CACHE_PATH = join(import.meta.dirname, '.liveness_cache.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;
const RATE_LIMIT_MS = 500; // 2 req/sec
const MAX_BODY_BYTES = 500_000;
const STALE_POSTING_AGE_DAYS = 45;
// Below this amount of visible (post-script/style/tag) text, we can't tell if a
// JS-rendered SPA is live or dead — mark unknown rather than falsely "live".
// E.g., scale.com, workday, some Ashby pages.
const MIN_VISIBLE_TEXT_CHARS = 200;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Case-insensitive substring signals from the spec
const DEAD_SIGNALS = [
  'this job has been removed',
  'this position is no longer available',
  'this job is no longer accepting applications',
  'sorry, this job was removed',
  'job not found',
  'position has been filled',
  'no longer open',
  // a few near-duplicates we see often in the wild
  'this job has expired',
  'no longer accepting applications',
  'this role has been filled',
];

// A redirect that lands on one of these path shapes is almost always
// "role removed, bounced to generic careers landing."
const GENERIC_CAREERS_PATHS = [
  /^\/?$/,
  /^\/careers\/?$/i,
  /^\/jobs\/?$/i,
  /^\/careers\/search\/?$/i,
  /^\/jobs\/search\/?$/i,
  /^\/positions\/?$/i,
  /^\/openings\/?$/i,
  /^\/company\/careers\/?$/i,
];

function loadCache() {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

// Read at most MAX_BODY_BYTES — enough for dead signals + meta tags without
// dragging down long-tail job pages.
async function readBodyCapped(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let total = 0;
  let out = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    out += decoder.decode(value, { stream: true });
    if (total >= MAX_BODY_BYTES) {
      try { await reader.cancel(); } catch {}
      break;
    }
  }
  out += decoder.decode();
  return out;
}

function isGenericCareersRedirect(originalUrl, finalUrl) {
  try {
    const orig = new URL(originalUrl);
    const final = new URL(finalUrl);
    if (orig.href === final.href) return false;
    // Same site, but landed on a generic careers root?
    const pathStripped = final.pathname.replace(/\/$/, '') || '/';
    const looksGeneric = GENERIC_CAREERS_PATHS.some((rx) => rx.test(pathStripped));
    if (looksGeneric) return true;
    // Greenhouse/Lever specific: redirected from /jobs/12345 to /jobs (no ID)
    const origHasJobId = /\/jobs?\/[^/]+/i.test(orig.pathname);
    const finalHasJobId = /\/jobs?\/[^/]+/i.test(final.pathname);
    if (origHasJobId && !finalHasJobId) return true;
    return false;
  } catch {
    return false;
  }
}

// Posting age — best-effort. We look at:
//   1. JSON-LD / meta "datePosted"
//   2. Greenhouse "posted_at"
//   3. Built In "Posted N days ago"
//   4. Generic "posted N days ago"
function extractPostingAgeDays(body) {
  if (!body) return null;

  const daysAgo = body.match(/posted\s+(\d+)\s+days?\s+ago/i);
  if (daysAgo) return parseInt(daysAgo[1], 10);

  const dateJson = body.match(/"datePosted"\s*:\s*"(\d{4}-\d{2}-\d{2})/);
  if (dateJson) {
    const posted = Date.parse(dateJson[1]);
    if (!Number.isNaN(posted)) {
      return Math.floor((Date.now() - posted) / (1000 * 60 * 60 * 24));
    }
  }

  const ghPosted = body.match(/"posted_at"\s*:\s*"(\d{4}-\d{2}-\d{2})/);
  if (ghPosted) {
    const posted = Date.parse(ghPosted[1]);
    if (!Number.isNaN(posted)) {
      return Math.floor((Date.now() - posted) / (1000 * 60 * 60 * 24));
    }
  }

  return null;
}

async function checkOne(url) {
  try {
    const res = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);
    const status = res.status;
    const finalUrl = res.url || url;

    if (status === 404 || status === 410) {
      return { result: 'stale', reason: `HTTP ${status}`, ageDays: null };
    }

    if (isGenericCareersRedirect(url, finalUrl)) {
      return { result: 'stale', reason: 'redirect to generic careers page', ageDays: null };
    }

    if (status < 200 || status >= 400) {
      return { result: 'unknown', reason: `HTTP ${status}`, ageDays: null };
    }

    const body = await readBodyCapped(res);
    const bodyLower = body.toLowerCase();
    for (const signal of DEAD_SIGNALS) {
      if (bodyLower.includes(signal)) {
        return {
          result: 'stale',
          reason: `body signal: "${signal}"`,
          ageDays: extractPostingAgeDays(body),
        };
      }
    }

    // SPA shell detection: strip scripts/styles/tags. If almost nothing is
    // visible, the content is JS-rendered and HTTP can't verify — return
    // unknown rather than a misleading "live".
    const visibleText = body
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (visibleText.length < MIN_VISIBLE_TEXT_CHARS) {
      return {
        result: 'unknown',
        reason: `SPA shell — ${visibleText.length} chars of visible text (JS-rendered)`,
        ageDays: null,
      };
    }

    return {
      result: 'live',
      reason: `HTTP ${status}`,
      ageDays: extractPostingAgeDays(body),
    };
  } catch (err) {
    const msg = (err && err.message) ? err.message.split('\n')[0] : String(err);
    return { result: 'unknown', reason: `fetch error: ${msg}`, ageDays: null };
  }
}

export async function checkLiveness(urls, { verbose = false, skipCache = false } = {}) {
  const uniqueUrls = Array.from(new Set(urls.filter(Boolean)));
  const cache = skipCache ? {} : loadCache();
  const now = Date.now();
  const results = new Map();
  let checked = 0;
  let cacheHits = 0;

  for (const url of uniqueUrls) {
    const cached = cache[url];
    if (cached && cached.checkedAt && now - cached.checkedAt < CACHE_TTL_MS) {
      results.set(url, cached);
      cacheHits++;
      if (verbose) {
        const icon = iconFor(cached.result);
        console.log(`  ${icon} cache  ${cached.result.padEnd(7)} ${url}`);
      }
      continue;
    }

    const result = await checkOne(url);
    const entry = { ...result, checkedAt: now };
    cache[url] = entry;
    results.set(url, entry);
    checked++;
    if (verbose) {
      const icon = iconFor(result.result);
      const age = result.ageDays != null ? ` [${result.ageDays}d]` : '';
      console.log(`  ${icon} ${result.result.padEnd(7)} ${url}${age}`);
      if (result.result !== 'live') console.log(`           ${result.reason}`);
    }

    // Rate limit: 2 req/sec. Skip sleep for the last URL.
    if (checked < uniqueUrls.length - cacheHits) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
    }
  }

  if (!skipCache) saveCache(cache);

  return {
    results,
    stats: { total: uniqueUrls.length, checked, cacheHits },
  };
}

export function formatLivenessCell(entry) {
  // Always return a non-empty string so Markdown column counts stay stable
  // (parseObsidianTable strips empty cells via filter(Boolean)).
  if (!entry) return '—';
  const base =
    entry.result === 'live' ? '🟢 Live' :
    entry.result === 'stale' ? '💀 Stale' :
    entry.result === 'unknown' ? '❓ Unknown' : '—';
  if (entry.ageDays != null && entry.ageDays >= STALE_POSTING_AGE_DAYS && entry.result !== 'stale') {
    return `${base} ⚠️ ${entry.ageDays}d`;
  }
  return base;
}

function iconFor(result) {
  return result === 'live' ? '🟢' : result === 'stale' ? '💀' : '❓';
}

export const _internals = {
  DEAD_SIGNALS,
  isGenericCareersRedirect,
  extractPostingAgeDays,
  CACHE_TTL_MS,
  STALE_POSTING_AGE_DAYS,
};

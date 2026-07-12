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

// Job aggregators / re-posters serve a full, healthy-looking 200 page even
// after the underlying role is gone, and they rarely emit a DEAD_SIGNALS
// phrase. So an HTTP 200 on one of these CANNOT confirm the posting is still
// open — we must not assert a bare "live" for them. We still trust the dead
// checks (a 404/410 or removal phrase on an aggregator is still authoritative);
// we only refuse to green-light an unverifiable 200, returning "unknown"
// instead. (A false "unknown" is acceptable; a false "live" is not.)
const AGGREGATOR_DOMAINS = new Set([
  'bebee.com',
  'jobilize.com',
  'theladders.com',
  'ziprecruiter.com',
  'whatjobs.com',
  'jooble.org',
  'lensa.com',
  'learn4good.com',
  'simplyhired.com',
  'talent.com',
  'sonicjobs.com',
  'disabledperson.com',
  'jobleads.com',
  'virtualvocations.com',
]);

function isAggregatorUrl(input) {
  let host;
  try {
    host = new URL(input).hostname.toLowerCase();
  } catch {
    return false;
  }
  host = host.replace(/^www\./, '');
  for (const domain of AGGREGATOR_DOMAINS) {
    if (host === domain || host.endsWith(`.${domain}`)) return true;
  }
  return false;
}

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

// Defense-in-depth URL validation to prevent SSRF via malicious or corrupted
// pipeline.md entries. Rejects non-http(s) schemes and private/loopback/
// link-local/metadata-service hosts. Does not do DNS resolution, so a
// public hostname pointing at a private IP via DNS would not be caught —
// fetch's redirect:'follow' is still a vector, so we also re-check res.url.
function isSafePublicUrl(input) {
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (!host) return false;
  // Reject literal localhost and common aliases
  if (host === 'localhost' || host === 'localhost.localdomain' || host.endsWith('.localhost')) return false;
  // IPv4 literal — block private/loopback/link-local/metadata
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [parseInt(ipv4[1], 10), parseInt(ipv4[2], 10)];
    if (a === 0) return false;                              // 0.0.0.0/8
    if (a === 10) return false;                             // 10.0.0.0/8
    if (a === 127) return false;                            // 127.0.0.0/8
    if (a === 169 && b === 254) return false;               // link-local + AWS metadata
    if (a === 172 && b >= 16 && b <= 31) return false;      // 172.16.0.0/12
    if (a === 192 && b === 168) return false;               // 192.168.0.0/16
    if (a >= 224) return false;                             // multicast/reserved
  }
  // IPv6 literal — block loopback, link-local, ULA, unspecified
  if (host.startsWith('[') || host.includes(':')) {
    const stripped = host.replace(/^\[|\]$/g, '');
    if (stripped === '::' || stripped === '::1') return false;
    if (stripped.startsWith('fe80:') || stripped.startsWith('fe80::')) return false;
    if (stripped.startsWith('fc') || stripped.startsWith('fd')) return false;
    if (stripped.startsWith('ff')) return false; // multicast
  }
  return true;
}

async function fetchWithTimeout(url, timeoutMs) {
  if (!isSafePublicUrl(url)) {
    throw new Error(`unsafe url: ${url}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    // Re-validate the post-redirect URL — a 302 to 169.254.169.254 would have
    // been followed without this check.
    if (response.url && !isSafePublicUrl(response.url)) {
      throw new Error(`unsafe redirect: ${response.url}`);
    }
    return response;
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

// A specific job posting carries an ID in the PATH (/jobs/12345, /job/abc) OR in
// the QUERY STRING (Greenhouse `gh_jid`, generic `jid`, Ashby `ashby_jid`, Lever
// `lever_id`). The old check tested `pathname` only, so a posting whose ID lives
// only in the query — e.g. `careers.example.com/jobs?gh_jid=123` redirecting to a
// bare `/jobs` index — read as Live even though the role was gone. Read the whole URL.
const JOB_ID_QUERY_KEYS = ['gh_jid', 'jid', 'ashby_jid', 'lever_id'];
function urlHasJobId(u) {
  if (/\/jobs?\/[^/]+/i.test(u.pathname || '')) return true;
  for (const key of JOB_ID_QUERY_KEYS) {
    const v = u.searchParams.get(key);
    if (v && v.trim()) return true;
  }
  return false;
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
    // Redirected from a specific posting to one without an ID (path OR query).
    // Catches /jobs/12345 → /jobs AND /jobs?gh_jid=123 → /jobs (ID only in query).
    const origHasJobId = urlHasJobId(orig);
    const finalHasJobId = urlHasJobId(final);
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

// Count visible chars in a response body, skipping <script>/<style> blocks
// and HTML tags, with whitespace runs collapsed to a single space (matching
// the original `.replace(/\s+/g, ' ').trim().length` semantics). Used by
// SPA-shell detection — we only need the count, never the stripped string.
//
// Walking the body avoids regex-replace patterns that static analyzers
// (CodeQL `js/incomplete-multi-character-sanitization`) flag as incomplete
// HTML sanitizers, even though nothing here is rendered/echoed/persisted as
// HTML. Over-skipping (e.g. accepting a tolerant `</script foo>` close) is
// the safe direction for this heuristic: it can only INCREASE the chance of
// classifying a thin page as "unknown" (correct), never as a false "live".
function spaShellVisibleLength(body) {
  const len = body.length;
  const lower = body.toLowerCase();
  const isWordChar = (ch) =>
    (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
  const startsBlock = (i, name) => {
    if (!lower.startsWith('<' + name, i)) return false;
    const after = lower[i + name.length + 1];
    return after === undefined || !isWordChar(after);
  };
  let i = 0;
  let count = 0;
  let pendingSpace = false;
  while (i < len) {
    const c = body[i];
    if (c === '<') {
      let blockName = null;
      if (startsBlock(i, 'script')) blockName = 'script';
      else if (startsBlock(i, 'style')) blockName = 'style';
      if (blockName !== null) {
        const openEnd = body.indexOf('>', i + 1);
        if (openEnd === -1) break;
        const closeStart = lower.indexOf('</' + blockName, openEnd + 1);
        if (closeStart === -1) break;
        const closeEnd = body.indexOf('>', closeStart);
        if (closeEnd === -1) break;
        i = closeEnd + 1;
        continue;
      }
      const tagEnd = body.indexOf('>', i + 1);
      if (tagEnd === -1) break;
      i = tagEnd + 1;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v') {
      pendingSpace = true;
      i++;
      continue;
    }
    if (pendingSpace && count > 0) count++;
    pendingSpace = false;
    count++;
    i++;
  }
  return count;
}

// Pure classifier — given an HTTP result, decide live/stale/unknown. Kept
// separate from the fetch so the decision logic is unit-testable without a
// network (mirrors classifyLiveness in liveness-core.mjs). Ordering matters:
// the authoritative DEAD checks (status, generic redirect, removal phrases)
// run first and apply even to aggregator URLs; the aggregator guard only
// intercepts an otherwise-"live" 200.
export function classifyHttpLiveness({ url, status, finalUrl = url, body = '' }) {
  if (status === 404 || status === 410) {
    return { result: 'stale', reason: `HTTP ${status}`, ageDays: null };
  }

  if (isGenericCareersRedirect(url, finalUrl)) {
    return { result: 'stale', reason: 'redirect to generic careers page', ageDays: null };
  }

  if (status < 200 || status >= 400) {
    return { result: 'unknown', reason: `HTTP ${status}`, ageDays: null };
  }

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

  // SPA shell detection — see spaShellVisibleLength() above for why this is
  // a character walk rather than a regex strip-then-measure.
  const visibleTextLength = spaShellVisibleLength(body);
  if (visibleTextLength < MIN_VISIBLE_TEXT_CHARS) {
    return {
      result: 'unknown',
      reason: `SPA shell — ${visibleTextLength} chars of visible text (JS-rendered)`,
      ageDays: null,
    };
  }

  // Aggregator guard: a healthy 200 here is not proof the role is open. We've
  // already honored the dead checks above, so this never hides a confirmed
  // dead listing — it only declines to assert "live" for an unverifiable one.
  if (isAggregatorUrl(finalUrl) || isAggregatorUrl(url)) {
    return {
      result: 'unknown',
      reason: 'aggregator domain — HTTP 200 cannot confirm not-dead',
      ageDays: extractPostingAgeDays(body),
    };
  }

  return {
    result: 'live',
    reason: `HTTP ${status}`,
    ageDays: extractPostingAgeDays(body),
  };
}

async function checkOne(url) {
  try {
    const res = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);
    const status = res.status;
    const finalUrl = res.url || url;
    // Only read the body for statuses where it informs the decision. 4xx/5xx
    // short-circuit in the classifier without needing it.
    const body = status >= 200 && status < 400 ? await readBodyCapped(res) : '';
    return classifyHttpLiveness({ url, status, finalUrl, body });
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
  // Returns a non-empty string for known results so the cell is never blank
  // in the published table.
  if (!entry) return '—';
  const base =
    entry.result === 'live' ? '🟢 Live' :
    entry.result === 'stale' ? '💀 Stale' :
    entry.result === 'unknown' ? '❓ Unknown' : '—';
  if (base === '—') return base;

  let cell = base;
  if (entry.ageDays != null && entry.ageDays >= STALE_POSTING_AGE_DAYS && entry.result !== 'stale') {
    cell = `${base} ⚠️ ${entry.ageDays}d`;
  }
  // Verified-as-of date: when the reader opens the tracker, every checked row
  // shows the date it was last verified. Appended only when we actually have a
  // check timestamp, e.g. "🟢 Live (2026-05-25)".
  if (entry.checkedAt) {
    const asOf = new Date(entry.checkedAt).toISOString().slice(0, 10);
    cell = `${cell} (${asOf})`;
  }
  return cell;
}

function iconFor(result) {
  return result === 'live' ? '🟢' : result === 'stale' ? '💀' : '❓';
}

export const _internals = {
  DEAD_SIGNALS,
  AGGREGATOR_DOMAINS,
  isAggregatorUrl,
  isGenericCareersRedirect,
  urlHasJobId,
  extractPostingAgeDays,
  classifyHttpLiveness,
  CACHE_TTL_MS,
  STALE_POSTING_AGE_DAYS,
};

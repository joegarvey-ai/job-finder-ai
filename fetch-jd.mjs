// fetch-jd.mjs — Fetch the JD body (and authoritative metadata) for a role.
//
// RCA II RC-1: no scraper ever populates `job.jd`, so `jdText` is always '' and
// four gates (G6 coding-skip, G11 JD-hash dedup, JD-body location, content_fit
// flag-matching) are dead code. This module gives them real input.
//
//   fetchJd(url, opts) -> {
//     jd,                // extracted JD text (capped)
//     title,             // the page's OWN job title (for title↔JD reconciliation)
//     atsLocation,       // authoritative location from an ATS JSON API (high conf)
//     jsonldLocation,    // location parsed from JSON-LD JobPosting (high conf)
//     jsonldLocationType,// e.g. 'TELECOMMUTE' → remote
//     canonicalUrl,      // <link rel=canonical> or an ATS apply link found in the body
//     httpStatus,
//     source,            // 'greenhouse-api' | 'lever-api' | 'html' | 'browser' | 'cache' | 'blocked' | 'error'
//     cached,            // true when served from disk cache
//   }
//
// Cost control lives in the CALLER (score-and-publish.mjs), which only fetches
// JDs for roles that survive the cheap gates and would land >= REVIEW. Results
// are cached to jds/{slug}-{hash}.md + a .jd_cache.json index so re-scans are free.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { _internals as livenessInternals } from './liveness-http.mjs';

// Aggregator / re-poster domains don't expose the real JD over HTTP — they serve a
// generic listing/consent shell. Reuse liveness-http's canonical aggregator set so
// we NEVER ingest that boilerplate as a "JD" (it would collide across dozens of
// unrelated roles and wrongly trip G11's JD-hash dedup, and corrupt content_fit).
const isAggregatorUrl = livenessInternals.isAggregatorUrl;

const ROOT = import.meta.dirname;
const JDS_DIR = join(ROOT, 'jds');
const CACHE_PATH = join(ROOT, '.jd_cache.json');
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;   // JDs change slowly; 14-day cache
const REQUEST_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 700_000;
const MAX_JD_CHARS = 40_000;
const MIN_JD_CHARS = 200;                         // below this, escalate to a browser

// Reuse the same desktop-Chrome UA convention as liveness-http.mjs.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ── URL safety (minimal SSRF guard — job URLs come from the user's own pipeline) ──
function isHttpPublicUrl(input) {
  let u;
  try { u = new URL(input); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  if (!h || h === 'localhost' || h.endsWith('.localhost')) return false;
  if (/^(0\.|10\.|127\.|169\.254\.|192\.168\.)/.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  return true;
}

// ── Cache ────────────────────────────────────────────────────────────────
function loadCache() {
  if (!existsSync(CACHE_PATH)) return {};
  try { return JSON.parse(readFileSync(CACHE_PATH, 'utf8')); } catch { return {}; }
}
function saveCache(cache) {
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}
function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'role';
}

// ── HTML helpers ───────────────────────────────────────────────────────────
function stripHtml(html) {
  return String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function capJd(text) {
  const t = String(text || '').trim();
  return t.length > MAX_JD_CHARS ? t.slice(0, MAX_JD_CHARS) : t;
}
function extractTag(html, re) {
  const m = String(html || '').match(re);
  return m ? m[1].trim() : '';
}

// Parse every <script type="application/ld+json"> block, flatten @graph, and
// return the first JobPosting object found.
function extractJobPostingJsonLd(html) {
  const blocks = [...String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    let data;
    try { data = JSON.parse(b[1].trim()); } catch { continue; }
    const candidates = [];
    const push = (x) => { if (x && typeof x === 'object') candidates.push(x); };
    if (Array.isArray(data)) data.forEach(push);
    else { push(data); if (Array.isArray(data['@graph'])) data['@graph'].forEach(push); }
    for (const c of candidates) {
      const type = c['@type'];
      if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) return c;
    }
  }
  return null;
}

// JSON-LD jobLocation → a flat "City, Region, Country" string. Handles the
// object / array / nested-address shapes schema.org allows.
function jsonldLocationString(jobLocation) {
  const one = (loc) => {
    const a = loc && (loc.address || loc);
    if (!a || typeof a !== 'object') return typeof loc === 'string' ? loc : '';
    return [a.addressLocality, a.addressRegion, a.addressCountry]
      .map((x) => (x && typeof x === 'object' ? x.name : x)).filter(Boolean).join(', ');
  };
  if (Array.isArray(jobLocation)) return jobLocation.map(one).filter(Boolean).join(' | ');
  return one(jobLocation);
}

// ── robots.txt (best-effort, per-host, cached for the run) ───────────────────
const robotsCache = new Map();   // host → array of disallowed path prefixes for '*'
async function disallowedByRobots(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const host = u.host;
  if (!robotsCache.has(host)) {
    let disallows = [];
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(`${u.origin}/robots.txt`, { signal: ctrl.signal, headers: { 'User-Agent': USER_AGENT } });
      clearTimeout(t);
      if (res.ok) {
        const txt = (await res.text()).slice(0, 100_000);
        // Collect Disallow rules under the '*' group only (conservative: we ignore
        // rules targeted at other named bots, and default to ALLOW on any doubt).
        let inStar = false;
        for (const raw of txt.split('\n')) {
          const line = raw.replace(/#.*$/, '').trim();
          if (!line) continue;
          const ua = line.match(/^user-agent:\s*(.+)$/i);
          if (ua) { inStar = ua[1].trim() === '*'; continue; }
          if (!inStar) continue;
          const dis = line.match(/^disallow:\s*(.*)$/i);
          if (dis) { const p = dis[1].trim(); if (p) disallows.push(p); }
        }
      }
    } catch { disallows = []; }
    robotsCache.set(host, disallows);
  }
  const path = u.pathname || '/';
  return robotsCache.get(host).some((p) => path.startsWith(p));
}

async function fetchText(url, { accept = 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8' } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' },
    });
    const reader = res.body?.getReader();
    let out = '', total = 0;
    if (reader) {
      const dec = new TextDecoder('utf-8', { fatal: false });
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.length; out += dec.decode(value, { stream: true });
        if (total >= MAX_BODY_BYTES) { try { await reader.cancel(); } catch {} break; }
      }
      out += dec.decode();
    }
    return { status: res.status, finalUrl: res.url || url, body: out };
  } finally {
    clearTimeout(timer);
  }
}

// ── ATS JSON fast paths (authoritative location, clean JD text) ──────────────
function greenhouseApi(url) {
  const m = url.match(/(?:job-boards|boards)\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/i)
    || url.match(/greenhouse\.io\/embed\/job_app\?[^#]*for=([^&]+)[^#]*gh_jid=(\d+)/i);
  if (!m) return null;
  return `https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs/${m[2]}`;
}
function leverApi(url) {
  const m = url.match(/jobs\.lever\.co\/([^/]+)\/([0-9a-f-]{16,})/i);
  if (!m) return null;
  return `https://api.lever.co/v0/postings/${m[1]}/${m[2]}`;
}

async function fetchViaGreenhouse(apiUrl) {
  const { status, body } = await fetchText(apiUrl, { accept: 'application/json' });
  if (status !== 200) return null;
  let j; try { j = JSON.parse(body); } catch { return null; }
  const loc = j.location?.name || '';
  return {
    jd: capJd(stripHtml(j.content || '')),
    title: j.title || '',
    atsLocation: loc,
    jsonldLocation: loc,
    jsonldLocationType: /remote/i.test(loc) ? 'TELECOMMUTE' : '',
    canonicalUrl: j.absolute_url || '',
    httpStatus: status,
    source: 'greenhouse-api',
  };
}
async function fetchViaLever(apiUrl) {
  const { status, body } = await fetchText(apiUrl, { accept: 'application/json' });
  if (status !== 200) return null;
  let j; try { j = JSON.parse(body); } catch { return null; }
  const loc = j.categories?.location || '';
  const workplace = j.workplaceType || '';   // 'remote' | 'hybrid' | 'on-site'
  const text = stripHtml(j.description || '') + ' ' +
    (Array.isArray(j.lists) ? j.lists.map((l) => `${l.text} ${stripHtml(l.content || '')}`).join(' ') : '');
  return {
    jd: capJd(text),
    title: j.text || '',
    atsLocation: [loc, workplace].filter(Boolean).join(' — '),
    jsonldLocation: loc,
    jsonldLocationType: /remote/i.test(workplace) || /remote/i.test(loc) ? 'TELECOMMUTE' : '',
    canonicalUrl: j.hostedUrl || j.applyUrl || '',
    httpStatus: status,
    source: 'lever-api',
  };
}

// ── Playwright escalation (403 / SPA shell / thin body) ──────────────────────
async function fetchViaBrowser(url) {
  let launchBrowser, newStealthPage;
  try {
    ({ launchBrowser, newStealthPage } = await import('./scrapers/lib/common.mjs'));
  } catch { return null; }
  let browser;
  try {
    browser = await launchBrowser({ stealth: true });
    const page = await newStealthPage(browser);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1500);
    const html = await page.content();
    const innerText = await page.evaluate(() => document.body?.innerText || '');
    const jp = extractJobPostingJsonLd(html);
    // As in the HTTP path: never fall back to raw page text for an aggregator shell.
    const jd = capJd((jp && stripHtml(jp.description)) || (isAggregatorUrl(url) ? '' : innerText));
    return {
      jd,
      title: (jp && jp.title) || extractTag(html, /<title[^>]*>([^<]+)<\/title>/i),
      atsLocation: '',
      jsonldLocation: jp ? jsonldLocationString(jp.jobLocation) : '',
      jsonldLocationType: jp?.jobLocationType || '',
      canonicalUrl: extractTag(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i),
      httpStatus: 200,
      source: 'browser',
    };
  } catch {
    return null;
  } finally {
    if (browser) { try { await browser.close(); } catch {} }
  }
}

// Find an ATS apply link (greenhouse/lever/ashby) embedded in an aggregator/WWR
// page — this is the canonical first-party posting a T3 mirror points at (G12).
function findAtsApplyLink(html) {
  const m = String(html || '').match(/https?:\/\/(?:[a-z0-9-]+\.)?(?:greenhouse\.io|lever\.co|ashbyhq\.com)\/[^\s"'<>]+/i);
  return m ? m[0].replace(/&amp;/g, '&') : '';
}

// ── Public: fetchJd ──────────────────────────────────────────────────────────
export async function fetchJd(url, { skipCache = false, browser = true, respectRobots = true } = {}) {
  const empty = { jd: '', title: '', atsLocation: '', jsonldLocation: '', jsonldLocationType: '', canonicalUrl: '', httpStatus: 0, source: 'error', cached: false };
  if (!url || !isHttpPublicUrl(url)) return { ...empty, source: 'blocked' };

  const cache = skipCache ? {} : loadCache();
  const hit = cache[url];
  if (hit && hit.fetchedAt && (Date.now() - hit.fetchedAt) < CACHE_TTL_MS) {
    let jd = '';
    if (hit.file && existsSync(join(ROOT, hit.file))) {
      try { jd = readFileSync(join(ROOT, hit.file), 'utf8').replace(/^---[\s\S]*?---\n/, ''); } catch {}
    }
    return { jd, title: hit.title || '', atsLocation: hit.atsLocation || '', jsonldLocation: hit.jsonldLocation || '',
      jsonldLocationType: hit.jsonldLocationType || '', canonicalUrl: hit.canonicalUrl || '', httpStatus: hit.httpStatus || 0,
      source: hit.source || 'cache', cached: true };
  }

  if (respectRobots && await disallowedByRobots(url)) {
    const res = { ...empty, source: 'blocked' };
    if (!skipCache) { cache[url] = { fetchedAt: Date.now(), source: 'blocked', httpStatus: 0 }; saveCache(cache); }
    return res;
  }

  let result = null;
  // 1) ATS JSON fast path — authoritative, cheap, clean.
  try {
    const gh = greenhouseApi(url); const lv = leverApi(url);
    if (gh) result = await fetchViaGreenhouse(gh);
    else if (lv) result = await fetchViaLever(lv);
  } catch { /* fall through to HTML */ }

  // 2) Generic HTML path.
  if (!result) {
    try {
      const { status, finalUrl, body } = await fetchText(url);
      const jp = extractJobPostingJsonLd(body);
      let jd = capJd((jp && stripHtml(jp.description)) || '');
      // Whole-page fallback ONLY for non-aggregators. An aggregator page without a
      // JSON-LD JobPosting is a generic shell — ingesting its text would be boilerplate
      // that collides across many roles (false G11) and pollutes content_fit.
      if (jd.length < MIN_JD_CHARS && !isAggregatorUrl(url) && !isAggregatorUrl(finalUrl)) jd = capJd(stripHtml(body));
      const canonical = extractTag(body, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
        || findAtsApplyLink(body);
      result = {
        jd,
        title: (jp && jp.title) || extractTag(body, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
          || extractTag(body, /<title[^>]*>([^<]+)<\/title>/i),
        atsLocation: '',
        jsonldLocation: jp ? jsonldLocationString(jp.jobLocation) : '',
        jsonldLocationType: jp?.jobLocationType || '',
        canonicalUrl: canonical,
        httpStatus: status,
        source: 'html',
        _thin: (status === 403) || (jd.length < MIN_JD_CHARS),
        _finalUrl: finalUrl,
      };
    } catch (err) {
      result = { ...empty, source: 'error', _thin: true, _err: err.message?.split('\n')[0] };
    }
  }

  // 3) Playwright escalation on 403 / SPA shell / thin body.
  if (browser && result && result._thin) {
    const b = await fetchViaBrowser(url);
    if (b && b.jd && b.jd.length >= MIN_JD_CHARS) result = b;
  }

  // Persist body + index entry.
  const jd = result.jd || '';
  let file = '';
  if (jd && result.source !== 'blocked') {
    try {
      if (!existsSync(JDS_DIR)) mkdirSync(JDS_DIR, { recursive: true });
      const h = createHash('sha1').update(url).digest('hex').slice(0, 10);
      file = `jds/${slugify(result.title || url)}-${h}.md`;
      const front = `---\nurl: ${url}\ntitle: ${(result.title || '').replace(/\n/g, ' ')}\nlocation: ${(result.atsLocation || result.jsonldLocation || '').replace(/\n/g, ' ')}\nsource: ${result.source}\nfetched: ${new Date(Date.now()).toISOString().slice(0, 10)}\n---\n`;
      writeFileSync(join(ROOT, file), front + jd);
    } catch { file = ''; }
  }
  if (!skipCache) {
    cache[url] = {
      fetchedAt: Date.now(), file, title: result.title || '', atsLocation: result.atsLocation || '',
      jsonldLocation: result.jsonldLocation || '', jsonldLocationType: result.jsonldLocationType || '',
      canonicalUrl: result.canonicalUrl || '', httpStatus: result.httpStatus || 0, source: result.source || 'error',
    };
    saveCache(cache);
  }

  return {
    jd, title: result.title || '', atsLocation: result.atsLocation || '', jsonldLocation: result.jsonldLocation || '',
    jsonldLocationType: result.jsonldLocationType || '', canonicalUrl: result.canonicalUrl || '',
    httpStatus: result.httpStatus || 0, source: result.source || 'error', cached: false,
  };
}

export const _internals = { stripHtml, extractJobPostingJsonLd, jsonldLocationString, greenhouseApi, leverApi, findAtsApplyLink, slugify };

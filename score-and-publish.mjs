#!/usr/bin/env node
// score-and-publish.mjs — Incremental scoring + Obsidian publishing
//
// On each run:
//   1. Reads existing Obsidian table (preserves user-edited Status, Added timestamps, Adj. scores)
//   2. Finds the latest daily digest OR reads all pipeline data
//   3. Scores ONLY new roles not already in Obsidian (dedup by URL)
//   4. Re-scores existing OPEN roles (🔲 New, 👀 Reviewing) in case scoring logic changed
//   5. Preserves rows where user set status (✅ Applied, ❌ Closed, ⏸️ Paused, 🚫 Rejected)
//   6. Reconciles evaluation scores from reports/ into Adj. column
//   7. Writes back with Adj. + Added timestamp columns
//
// Table columns: Score | Adj. | Company | Role | Level | Domain | Location | Link | Status | Liveness | Added
//   Location = 🌐 Remote / 🏙️ Hybrid / 🏢 Onsite / 📍 Unknown, classified from the
//   scraper location, evaluation report, role title, and URL.
//   With geographic.remote_only: true, only Remote + allowed-metro Hybrid surface in
//   the top sections; Unknown → "Needs location check"; other Onsite/Hybrid → collapsible.
//
// Usage:
//   node score-and-publish.mjs              # Incremental + reconcile (default)
//   node score-and-publish.mjs --full       # Re-score everything from pipeline + all digests
//   node score-and-publish.mjs --no-reconcile # Skip evaluation score reconciliation

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { createHash } from 'crypto';
import yaml from 'js-yaml';
import { checkLiveness, formatLivenessCell } from './liveness-http.mjs';
import { parseTableRow, splitTableRow } from './obsidian-table.mjs';

// Optional dotenv (so OBSIDIAN_VAULT_PATH can live in .env)
try {
  const { config } = await import('dotenv');
  config();
} catch {
  // dotenv not installed — fall through to process.env directly
}

const ROOT = import.meta.dirname;

// OBSIDIAN_VAULT_PATH points to your Obsidian vault root. Reads only here — the
// hard exit on a missing/absent vault is deferred to requireVault() so this
// module can be IMPORTED by test-all.mjs (for classifyLevel/applyGates/…) without
// running the pipeline or calling process.exit.
const OBSIDIAN_VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH;
const SCANNER_RELATIVE_PATH = process.env.OBSIDIAN_SCANNER_RELATIVE_PATH
  || '02 Personal Projects/Career Collateral/Career_Ops_Scanner.md';
const OBSIDIAN_FILE = OBSIDIAN_VAULT_PATH ? join(OBSIDIAN_VAULT_PATH, SCANNER_RELATIVE_PATH) : null;

function requireVault() {
  if (!OBSIDIAN_VAULT_PATH) {
    console.error('score-and-publish.mjs requires OBSIDIAN_VAULT_PATH to be set.');
    console.error('');
    console.error('This script publishes scored job roles to an Obsidian vault. If you don\'t use');
    console.error('Obsidian, you can skip it — career-ops works fine without it. The /career-ops scan');
    console.error('command uses Claude Code directly and doesn\'t need this script.');
    console.error('');
    console.error('To enable: copy .env.example to .env and set OBSIDIAN_VAULT_PATH.');
    process.exit(2);
  }
  if (!existsSync(OBSIDIAN_VAULT_PATH)) {
    console.error(`OBSIDIAN_VAULT_PATH does not exist: ${OBSIDIAN_VAULT_PATH}`);
    console.error('Check that the path in .env points to your actual Obsidian vault.');
    process.exit(2);
  }
}

const NOW = new Date();
const TODAY = NOW.toISOString().slice(0, 10);
const TIMESTAMP = NOW.toISOString().slice(0, 16).replace('T', ' ');
const FULL_MODE = process.argv.includes('--full');
const RECONCILE_MODE = !process.argv.includes('--no-reconcile');
const SKIP_LIVENESS = process.argv.includes('--skip-liveness');
const VERBOSE_LIVENESS = process.argv.includes('--verbose-liveness');
// --dry-run: compute + report the gate breakdown and new top-10 WITHOUT
// overwriting the live Career_Ops_Scanner.md. Writes a preview file to data/.
const DRY_RUN = process.argv.includes('--dry-run');

// ── Statuses that mean "user took action — don't re-score or remove" ──
const LOCKED_STATUSES = ['✅ Applied', '❌ Closed', '⏸️ Paused', '🚫 Rejected', '🎯 Interview', '🤝 Offer'];
// Statuses that mean "still open — re-score is OK"
const OPEN_STATUSES = ['🔲 New', '👀 Reviewing'];

// ── Company tiers ────────────────────────────────────────────────────────
//
// Load from config/profile.yml under `scoring.company_tiers`. If that section
// is absent, fall back to the AI/data/devtools-flavored defaults below (which
// reflect the original author's PM-in-AI search). Friend forks: add a
// scoring.company_tiers section to your profile.yml — see profile.example.yml.
//
// Substring match (case-insensitive) against company name, so "weights &
// biases" catches "Weights & Biases AI" too.

const DEFAULT_COMPANY_TIERS = {
  tier_1: ['anthropic', 'snowflake', 'databricks', 'dbt labs', 'stripe'],
  tier_2: ['notion', 'figma', 'braze', 'iterable', 'segment', 'twilio', 'hubspot',
    'amplitude', 'mixpanel', 'glean', 'retool'],
  tier_3: ['adobe', 'salesforce', 'medallia', 'qualtrics', 'scale ai', 'weights & biases',
    'weights and biases', 'langfuse'],
  strong: ['datadog', 'asana', 'postman', 'klaviyo', 'fivetran', 'pagerduty',
    'launchdarkly', 'newrelic', 'new relic', 'dropbox', 'reddit', 'confluent', 'clickup',
    'gitlab', 'digitalocean', 'okta', 'lattice', 'domino data lab', 'instacart', 'affirm',
    'mercury', 'descript', 'bloomreach', 'attentive', 'socure', 'geico', 'workday', 'autodesk',
    'merck', 'axon'],
};

function loadCompanyTiers() {
  const profilePath = join(ROOT, 'config', 'profile.yml');
  if (!existsSync(profilePath)) return DEFAULT_COMPANY_TIERS;
  try {
    const profile = yaml.load(readFileSync(profilePath, 'utf8')) || {};
    const ct = profile.scoring?.company_tiers;
    if (!ct) return DEFAULT_COMPANY_TIERS;
    const lower = (arr) => Array.isArray(arr) ? arr.map(s => String(s).toLowerCase()) : [];
    return {
      tier_1: lower(ct.tier_1).length ? lower(ct.tier_1) : DEFAULT_COMPANY_TIERS.tier_1,
      tier_2: lower(ct.tier_2).length ? lower(ct.tier_2) : DEFAULT_COMPANY_TIERS.tier_2,
      tier_3: lower(ct.tier_3).length ? lower(ct.tier_3) : DEFAULT_COMPANY_TIERS.tier_3,
      strong: lower(ct.strong).length ? lower(ct.strong) : DEFAULT_COMPANY_TIERS.strong,
    };
  } catch (err) {
    console.warn(`Warning: could not parse scoring.company_tiers from profile.yml (${err.message}). Using defaults.`);
    return DEFAULT_COMPANY_TIERS;
  }
}

const COMPANY_TIERS = loadCompanyTiers();

function getCompanyTier(company) {
  const c = company.toLowerCase();
  if (COMPANY_TIERS.tier_1.some(t => c.includes(t))) return { tier: 1, label: '🏆 T1' };
  if (COMPANY_TIERS.tier_2.some(t => c.includes(t))) return { tier: 2, label: '⭐ T2' };
  if (COMPANY_TIERS.tier_3.some(t => c.includes(t))) return { tier: 3, label: '🔷 T3' };
  if (COMPANY_TIERS.strong.some(t => c.includes(t))) return { tier: 2.5, label: '💼' };
  return { tier: 4, label: '' };
}

// ── Scoring Model V2 config (Brief V1.2, 2026-07-10) ───────────────────────
//
// USER-layer values live in config/profile.yml under `scoring`. The system
// ships sane defaults so a trimmed profile still scores. GOVERNING PRINCIPLE:
// the brief's hard skips (N1–N12) are GATES, not WEIGHTS. Gates run BEFORE the
// weighted mean and drop/quarantine; a hard skip can never be out-competed by a
// strong title. The old level_scores ladder + level floors are DELETED — level
// is now a gate (demotions drop; all pass-levels are equivalent, content ranks).

const DEFAULT_SCORING = {
  comp_floor: 200000,
  level_gate: {
    pass: ['senior manager', 'principal', 'group product manager', 'staff', 'lead',
      'director', 'head of', 'vice president', 'vp'],
    drop: ['senior product manager', 'sr product manager', 'product manager ii',
      'product manager iii', 'associate product manager', 'junior product manager'],
  },
  weights: { content_fit: 0.50, domain_fit: 0.15, comp: 0.15, location: 0.10, career_trajectory: 0.05, company_tier: 0.05 },
  source_tiers: {
    t1: ['greenhouse.io', 'lever.co', 'ashbyhq.com', 'myworkdayjobs.com'],
    t2: ['weworkremotely.com', 'builtin.com', 'linkedin.com'],
    t3: ['jobleads.com', 'trabajo.org', 'jooble.org', 'whatjobs.com', 'jobilize.com',
      'learn4good.com', 'lensa.com', 'theladders.com', 'salutemyjob.com', 'mediabistro.com'],
  },
  content_fit: {
    green_flags: ['product strategy', 'roadmap', 'cross-functional', 'ai/ml', 'ai product',
      'llm', 'rag', 'agentic', 'mcp', 'evals', 'guardrails', 'ai governance', 'platform',
      'developer platform', 'martech', 'marketing operations', 'attribution', 'segmentation',
      'cdp', 'data platform', 'analytics', 'enterprise', 'b2b', 'stakeholder', 'quality bar',
      'prototype', 'prototyping', 'builder', '0-to-1', 'founding pm', 'prompt engineering', 'ai-native'],
    red_flags: ['product marketing', 'consumer', 'b2c', 'd2c', 'direct-to-consumer', 'growth hacking', 'p&l ownership'],
  },
  gates: {
    coding_skip: ['proficiency in python', 'proficiency in java', 'proficiency in typescript',
      'proficiency in go', 'review pull requests', 'reviewing pull requests', 'code review',
      'coding assessment', 'coding exercise', 'coding challenge', 'live coding', 'take-home coding', 'pair programming interview'],
    api_ml_research: ['sdk', 'forward deployed', 'forward-deployed', 'solutions architect',
      'solutions engineer', 'core model', 'model training', 'ml infrastructure', 'ml infra',
      'research scientist', 'research engineer', 'developer experience engineer'],
    consumer: ['consumer product', 'b2c', 'd2c', 'direct-to-consumer', 'consumer app', 'consumer-facing app'],
    product_ok: ['product manager', 'product management', 'head of product', 'director of product',
      'director, product', 'group product manager', 'principal pm', 'staff pm', 'product lead', 'vp product', 'vp, product'],
    martech_ok: ['marketing operations', 'martech', 'marketing technology', 'lifecycle marketing', 'growth platform', 'marketing ops'],
  },
};

function loadScoringConfig() {
  const profilePath = join(ROOT, 'config', 'profile.yml');
  const cfg = JSON.parse(JSON.stringify(DEFAULT_SCORING)); // deep clone of defaults
  if (!existsSync(profilePath)) return cfg;
  try {
    const profile = yaml.load(readFileSync(profilePath, 'utf8')) || {};
    const s = profile.scoring || {};
    const lowerArr = (a, fb) => Array.isArray(a) && a.length ? a.map(x => String(x).toLowerCase().trim()).filter(Boolean) : fb;
    if (typeof s.comp_floor === 'number' && Number.isFinite(s.comp_floor)) cfg.comp_floor = s.comp_floor;
    else if (typeof profile.compensation?.minimum_total_comp === 'number') cfg.comp_floor = profile.compensation.minimum_total_comp;
    if (s.level_gate) {
      cfg.level_gate.pass = lowerArr(s.level_gate.pass, cfg.level_gate.pass);
      cfg.level_gate.drop = lowerArr(s.level_gate.drop, cfg.level_gate.drop);
    }
    if (s.weights && typeof s.weights === 'object') {
      for (const [k, v] of Object.entries(s.weights)) if (typeof v === 'number' && Number.isFinite(v)) cfg.weights[k] = v;
    }
    if (s.source_tiers) for (const t of ['t1', 't2', 't3']) cfg.source_tiers[t] = lowerArr(s.source_tiers[t], cfg.source_tiers[t]);
    if (s.content_fit) {
      cfg.content_fit.green_flags = lowerArr(s.content_fit.green_flags, cfg.content_fit.green_flags);
      cfg.content_fit.red_flags = lowerArr(s.content_fit.red_flags, cfg.content_fit.red_flags);
    }
    if (s.gates) for (const g of Object.keys(cfg.gates)) cfg.gates[g] = lowerArr(s.gates[g], cfg.gates[g]);
    return cfg;
  } catch (err) {
    console.warn(`Warning: could not parse scoring from profile.yml (${err.message}). Using defaults.`);
    return cfg;
  }
}

const SCORING = loadScoringConfig();
const includesAny = (text, phrases) => { const t = (text || '').toLowerCase(); return phrases.some(p => t.includes(p)); };
const countHits = (text, phrases) => { const t = (text || '').toLowerCase(); return phrases.reduce((n, p) => n + (t.includes(p) ? 1 : 0), 0); };

// ── Level: ladder → GATE (Task 2a) ─────────────────────────────────────────
// Returns { level, gate: 'pass'|'drop', track: 'product'|'martech'|'other' }.
// Order is deliberate (Task 2a / RCA RC2):
//   1. junk (intern/contractor/…) → drop
//   2. DEMOTION list FIRST → drop (a demotion is never rescued by a good modifier)
//   3. MARKETING-OPS above the generic senior-manager check — otherwise
//      "Senior Manager, Lifecycle Marketing Operations" impersonates a PM Sr
//      Manager (the Glean bug). Classify it as martech.
//   4. pass-leadership levels → pass (ALL EQUIVALENT — level never ranks)
//   5. plain PM / other
function classifyLevel(title) {
  const t = (title || '').toLowerCase();

  if (/\b(intern|internship|apprentice|instructor|auditor|contractor|part-time)\b/.test(t))
    return { level: 'SKIP', gate: 'drop', track: 'other' };

  // 2. Demotions FIRST.
  if (SCORING.level_gate.drop.some(p => t.includes(p))) {
    const label = t.includes('associate') ? 'Associate PM'
      : /product manager ii?i/.test(t) ? 'PM II/III'
      : 'Senior PM';
    return { level: label, gate: 'drop', track: 'product' };
  }

  // 3. Marketing-ops BEFORE the senior-manager check.
  const isMartech = /marketing operations|marketing ops|martech|marketing technology|lifecycle marketing/.test(t);
  if (isMartech) {
    const leadership = /director|head|principal|\bvp\b|vice president|senior manager|\blead\b|group/.test(t);
    return { level: leadership ? 'MktOps Lead' : 'MktOps', gate: 'pass', track: 'martech' };
  }

  // 4. Pass-leadership levels (all equivalent — content decides, not level).
  const passHit = SCORING.level_gate.pass.find(p => t.includes(p));
  if (passHit) {
    const label =
      t.includes('principal') ? 'Principal'
      : /\bstaff\b/.test(t) ? 'Staff'
      : t.includes('group product manager') || /\bgroup\b/.test(t) ? 'Group PM'
      : /director|head of|vice president|\bvp\b/.test(t) ? 'Director+'
      : /senior manager|\bsr\.?\s+(group\s+)?manager\b/.test(t) ? 'Sr Manager'
      : /\blead\b/.test(t) ? 'Lead'
      : 'Lead';
    return { level: label, gate: 'pass', track: 'product' };
  }

  // 5. Plain PM / other. Not a demotion, not leadership → survives the level gate;
  // content_fit + role-type gate (G9) decide where it lands.
  if (/product manager|product management|\bpm\b|product owner/.test(t))
    return { level: 'PM', gate: 'pass', track: 'product' };
  return { level: 'Other', gate: 'pass', track: 'other' };
}

// ── Source trust tiering (Task 2e) ─────────────────────────────────────────
function sourceTier(url) {
  const u = (url || '').toLowerCase();
  if (!u) return { tier: 3, label: 'T3' };
  if (SCORING.source_tiers.t1.some(d => u.includes(d))) return { tier: 1, label: 'T1' };
  if (SCORING.source_tiers.t3.some(d => u.includes(d))) return { tier: 3, label: 'T3' };
  if (SCORING.source_tiers.t2.some(d => u.includes(d))) return { tier: 2, label: 'T2' };
  // A company's own careers domain (not an aggregator, not a known board) → treat
  // as T1-equivalent (authoritative first-party posting).
  return { tier: 1, label: 'T1' };
}

// International detector (G4). US states/DC + "remote (us)" are domestic; a
// non-US country/city name is international. Best-effort on the resolved string.
const INTL_PLACES = ['london', 'uk', 'united kingdom', 'england', 'ireland', 'dublin',
  'canada', 'toronto', 'vancouver', 'ontario', 'germany', 'berlin', 'munich', 'france',
  'paris', 'spain', 'madrid', 'barcelona', 'netherlands', 'amsterdam', 'india', 'bangalore',
  'bengaluru', 'singapore', 'australia', 'sydney', 'melbourne', 'israel', 'tel aviv',
  'poland', 'warsaw', 'brazil', 'mexico', 'japan', 'tokyo', 'europe', 'emea', 'apac', 'latam'];
function isInternational(text) {
  const t = (text || '').toLowerCase();
  if (!t) return false;
  if (/\b(remote[\s,-]*us|united states|u\.s\.|usa)\b/.test(t)) return false;
  return INTL_PLACES.some(p => new RegExp('\\b' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(t));
}

// Employer↔JD plausibility flag (G11, cheap half). A manufacturing / industrial
// employer "posting" a software/martech/product role is the Dormont signature.
const INDUSTRIAL_EMPLOYER = /manufactur|\bmfg\b|foundry|\bsteel\b|plumbing|connector|castings?|industrial supply|machining|fabricat/i;
function employerRoleImplausible(company, title) {
  const c = (company || '').toLowerCase();
  const t = (title || '').toLowerCase();
  const softwareRole = /marketing operations|martech|saas|product manager|software|platform|hubspot|salesforce|pardot|marketo/.test(t);
  return INDUSTRIAL_EMPLOYER.test(c) && softwareRole;
}

// ── Domain fit (0–5) ───────────────────────────────────────────────────────
function getDomainScore(title, company) {
  const t = (title + ' ' + company).toLowerCase();
  let score = 0;
  const signals = [];
  if (t.match(/\bai\b/) || t.includes('machine learning') || t.includes('ml') || t.includes('llm') || t.includes('agentic') || t.includes('genai')) { score += 2; signals.push('AI/ML'); }
  if (t.includes('data') || t.includes('analytics') || t.includes('observability') || t.includes('monitoring') || t.includes('telemetry')) { score += 1.5; signals.push('Data'); }
  if (t.includes('platform') || t.includes('developer') || t.includes('api') || t.includes('ecosystem') || t.includes('integration')) { score += 1.5; signals.push('Platform'); }
  if (t.includes('marketing') || t.includes('martech') || t.includes('attribution') || t.includes('segmentation')) { score += 1.5; signals.push('MarTech'); }
  if (t.includes('enterprise')) { score += 1; signals.push('Enterprise'); }
  if (t.includes('security') || t.includes('compliance') || t.includes('identity')) { score += 0.5; signals.push('Security'); }
  if (t.includes('ecommerce') || t.includes('payments') || t.includes('fintech') || t.includes('billing') || t.includes('financial') || t.includes('cards')) { score -= 0.5; signals.push('FinTech'); }
  if (t.includes('mobile') || t.includes('consumer') || t.includes('gaming') || t.includes('health') || t.includes('medtech') || t.includes('aerospace')) { score -= 1; signals.push('Other'); }
  const raw03 = Math.max(0, Math.min(3, score));
  return { score: raw03, score05: Math.round(raw03 * (5 / 3) * 10) / 10, signals };
}

function getRecommendation(score) {
  if (score >= 4.0) return '🟢 APPLY';
  if (score >= 3.0) return '🟡 REVIEW';
  if (score >= 2.0) return '🟠 WEAK';
  return '⚪ SKIP';
}

// ── GATES — run BEFORE scoring (Task 2b) ───────────────────────────────────
// job: { title, company, url, location (resolved raw), jd? , comp? }
// ctx: { loc: {cls, metro, resolved}, level, src, jdDupCompanies:Set, t1Index:Set }
// Returns { verdict: 'pass'|'drop'|'quarantine'|'cap_review', reasons:[], flags:[], track, compSource }
function applyGates(job, ctx) {
  const reasons = [];
  const flags = [];
  const level = ctx.level || classifyLevel(job.title);
  const loc = ctx.loc || { cls: 'Unknown', metro: false, resolved: false };
  const src = ctx.src || sourceTier(job.url);
  const jdText = job.jd || '';
  const haystack = `${job.title || ''} ${jdText}`;
  let verdict = 'pass';
  const escalate = (v) => {
    const order = { pass: 0, cap_review: 1, quarantine: 2, drop: 3 };
    if (order[v] > order[verdict]) verdict = v;
  };

  // G1 — demotion title
  if (level.gate === 'drop') { escalate('drop'); reasons.push('G1 demotion title'); }

  // G2 — comp floor. Unknown comp does NOT drop (flag + neutral).
  let compSource = 'unknown';
  if (typeof job.comp === 'number' && Number.isFinite(job.comp)) {
    compSource = src.tier === 3 ? 'estimate' : 'employer';
    if (compSource === 'employer' && job.comp < SCORING.comp_floor) {
      escalate('drop'); reasons.push(`G2 comp $${job.comp} < floor $${SCORING.comp_floor}`);
    }
  } else {
    flags.push('⚠️ comp unverified');
  }

  // G11 — legitimacy FIRST: same JD body under ≥2 employers, or an implausible
  // employer↔role (the Dormont case). A suspect posting's self-reported facts —
  // including its location — are untrusted, so we QUARANTINE for human review
  // rather than letting its (possibly fabricated) location silently DROP it.
  const suspect = (ctx.jdDupCompanies && ctx.jdDupCompanies.size >= 2) || employerRoleImplausible(job.company, job.title);
  if (suspect) { escalate('quarantine'); reasons.push('G11 suspect attribution'); flags.push('⚠️ suspect attribution'); }

  // Location gates — active only under remote_only, and skipped for suspect rows
  // (their location can't be trusted; they're already quarantined above).
  if (GEO.remoteOnly && !suspect) {
    // G4 — international (check before G3 so the reason is specific). Title too,
    // because the geo marker often lives there ("[EUROPE ONLY]", "PM — London").
    if (isInternational(job.location) || isInternational(jdText) || isInternational(job.title)) {
      escalate('drop'); reasons.push('G4 international');
    } else if (loc.resolved) {
      // G3 — resolved location must be Remote-US / Seattle hybrid / Seattle onsite
      const ok = loc.cls === 'Remote' || ((loc.cls === 'Hybrid' || loc.cls === 'Onsite') && loc.metro);
      if (!ok) { escalate('drop'); reasons.push(`G3 location ${loc.cls}${loc.metro ? ' (metro)' : ' (outside Seattle metro)'}`); }
    } else {
      // G5 — unresolved location → quarantine (cannot publish above REVIEW)
      escalate('quarantine'); reasons.push('G5 location unresolved'); flags.push('📍 location unresolved');
    }
  } else if (GEO.remoteOnly && suspect) {
    flags.push('📍 location untrusted');
  }

  // G6 — unassisted coding / assessment / PR-review (JD-dependent). "hands-on
  // prototyping" is intentionally NOT here (AI-assisted building is a strength).
  if (jdText && includesAny(jdText, SCORING.gates.coding_skip)) { escalate('drop'); reasons.push('G6 unassisted-coding signal'); }

  // G7 — API/SDK-as-product · core-model/ML-infra/research · forward-deployed/SA
  if (includesAny(haystack, SCORING.gates.api_ml_research)) { escalate('drop'); reasons.push('G7 API/SDK/ML-infra/research/FD'); }

  // G8 — consumer product
  if (includesAny(haystack, SCORING.gates.consumer)) { escalate('drop'); reasons.push('G8 consumer product'); }

  // G9 — role type. Product & MarTech-leadership are targets; anything else is
  // routed to a separate track (capped, never floored into APPLY) — not dropped,
  // so a legit off-track role stays visible for review.
  let track = level.track;
  const isProduct = level.track === 'product' || includesAny(haystack, SCORING.gates.product_ok);
  const isMartech = level.track === 'martech' || includesAny(haystack, SCORING.gates.martech_ok);
  if (isMartech && !isProduct) { track = 'martech'; flags.push('track: MarTech'); }
  else if (isProduct) { track = 'product'; }
  else { track = 'other'; escalate('cap_review'); reasons.push('G9 off-track role type'); flags.push('track: other'); }

  // G12 — T3 aggregator not resolved to a canonical T1 posting → cap at REVIEW
  if (src.tier === 3) {
    const key = `${(job.company || '').toLowerCase().trim()}|${(job.title || '').toLowerCase().trim()}`;
    const resolvedToT1 = ctx.t1Index && ctx.t1Index.has(key);
    if (!resolvedToT1) { escalate('cap_review'); reasons.push('G12 T3 source unresolved'); flags.push('T3 source'); }
  }

  return { verdict, reasons, flags, track, compSource };
}

// ── Weighted score — gates already passed (Task 2c) ────────────────────────
// Each dimension 0–5; weights from profile.yml. Returns S1 (deterministic).
function contentFitS1(job) {
  const text = job.jd || job.title || '';
  const green = countHits(text, SCORING.content_fit.green_flags);
  const red = countHits(text, SCORING.content_fit.red_flags);
  const s = 3 + Math.min(green, 5) * 0.4 - red * 0.6;
  return Math.max(0, Math.min(5, Math.round(s * 10) / 10));
}

function compScore05(job, compSource) {
  if (typeof job.comp === 'number' && Number.isFinite(job.comp)) {
    if (compSource === 'estimate') return 3;      // don't trust aggregator bands
    if (job.comp >= 350000) return 5;
    if (job.comp >= 250000) return 4.5;
    if (job.comp >= SCORING.comp_floor) return 4;
    return 1;                                      // below floor (normally gated out)
  }
  return 3;                                        // unknown → neutral
}

function locationScore05(loc) {
  if (!loc) return 2;
  if (loc.cls === 'Remote') return 5;
  if (loc.cls === 'Hybrid') return loc.metro ? 4 : 1;
  if (loc.cls === 'Onsite') return loc.metro ? 3 : 1;
  return 2;                                        // unknown
}

function trajectoryScore05(job) {
  const t = `${job.title || ''} ${job.jd || ''}`.toLowerCase();
  if (/agentic|\bllm\b|ai product|ai-native|builder|prototyp|\bmcp\b|evals/.test(t)) return 5;
  if (/\bai\b|platform|data|developer/.test(t)) return 4;
  if (/marketing operations|martech/.test(t)) return 3.5;
  return 3;
}

function computeScore(job, ctx = {}) {
  const company = job.company || '';
  const loc = ctx.loc || { cls: 'Unknown', metro: false };
  const compSource = ctx.compSource || 'unknown';
  const level = ctx.level || classifyLevel(job.title);
  const companyInfo = getCompanyTier(company);
  const domainInfo = getDomainScore(job.title || '', company);

  const companyNorm = companyInfo.tier <= 1 ? 5 : companyInfo.tier <= 2 ? 4 : companyInfo.tier <= 2.5 ? 3.5 : companyInfo.tier <= 3 ? 3 : 2;

  const dims = {
    content_fit: contentFitS1(job),
    domain_fit: domainInfo.score05,
    comp: compScore05(job, compSource),
    location: locationScore05(loc),
    career_trajectory: trajectoryScore05(job),
    company_tier: companyNorm,
  };
  const w = SCORING.weights;
  let composite = 0;
  for (const [k, v] of Object.entries(dims)) composite += v * (w[k] || 0);
  const score_s1 = Math.round(composite * 10) / 10;

  // S2 refinement: an LLM JD-depth evaluation (reports/) supersedes the
  // deterministic S1 composite when present. score_s2 is null until then.
  const score_s2 = (typeof ctx.evalScore === 'number' && Number.isFinite(ctx.evalScore)) ? ctx.evalScore : null;
  const authoritative = score_s2 != null ? score_s2 : score_s1;
  const stage = score_s2 != null ? 'S2' : 'S1';

  return {
    score: authoritative,
    score_s1,
    score_s2,
    stage,
    dims,
    recommendation: getRecommendation(authoritative),
    level: level.level,
    track: level.track,
    domain: domainInfo.signals.join(', ') || '—',
    companyLabel: companyInfo.label,
  };
}

// ── Geographic filtering (remote-only) ─────────────────────────────────────
//
// Loaded from config/profile.yml under `geographic`:
//   remote_only: true              → main results show only Remote + allowed-metro Hybrid
//   allowed_hybrid_metros: [...]   → metros where a Hybrid role is still commutable
// When remote_only is false the scanner behaves exactly as before (no gating);
// the Location column is still shown, purely informational.

function loadGeographic() {
  const profilePath = join(ROOT, 'config', 'profile.yml');
  const fallback = { remoteOnly: false, metros: [] };
  if (!existsSync(profilePath)) return fallback;
  try {
    const profile = yaml.load(readFileSync(profilePath, 'utf8')) || {};
    const g = profile.geographic || {};
    const metros = Array.isArray(g.allowed_hybrid_metros)
      ? g.allowed_hybrid_metros.map((m) => String(m).toLowerCase().trim()).filter(Boolean)
      : [];
    return { remoteOnly: g.remote_only === true, metros };
  } catch (err) {
    console.warn(`Warning: could not parse geographic from profile.yml (${err.message}). Remote filter off.`);
    return fallback;
  }
}

const GEO = loadGeographic();

// Regional phrasings that mean "Seattle metro" even without a listed city name.
const METRO_VARIANTS = [
  'greater seattle', 'seattle metro', 'seattle area', 'puget sound',
  'eastside', 'south king county', 'north pierce',
];

function buildMetroMatcher(metros) {
  const names = [...metros, ...METRO_VARIANTS].filter(Boolean);
  const patterns = names.map(
    (n) => new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i')
  );
  return (text) => !!text && patterns.some((re) => re.test(text));
}

const inAllowedMetro = buildMetroMatcher(GEO.metros);

// Pull location hints out of a job URL (aggregators encode city/remote in the path).
// Goodwin's and Dormont's cities were literally in the JobLeads slug and went
// unparsed because only whatjobs + ziprecruiter were handled (RCA RC4 / Task 2d).
function locationFromUrl(url) {
  const out = [];
  if (!url) return out;
  const lower = url.toLowerCase();
  let m = lower.match(/whatjobs\.com\/jobs\/[^/]+\/([^/?#]+)/);
  if (m) out.push(m[1].replace(/-/g, ' '));
  m = url.match(/\/-in-([^/?#]+)/i); // ziprecruiter: /-in-Remote,OR  /-in-Union-City,NJ
  if (m) out.push(m[1].replace(/-/g, ' '));
  // JobLeads (and similar) encode the city as a `--city--` segment before the
  // trailing hash: …--washington--<hash>, …--holmdel-township--<hash>.
  m = lower.match(/--([a-z][a-z-]*?)--[0-9a-f]{6,}/);
  if (m) out.push(m[1].replace(/-/g, ' '));
  // Jobilize / Learn4Good: /job/us-<st>-<city>-<role-keyword>…
  m = lower.match(/\/(?:amp\/)?job\/us-([a-z]{2})-([a-z][a-z-]*?)-(?:sr|senior|director|principal|staff|lead|group|head|vp|manager|product|marketing|associate|junior|program|project|data|analyst|engineer)\b/);
  if (m) out.push(`${m[2].replace(/-/g, ' ')}, ${m[1].toUpperCase()}`);
  if (/\bremote\b/.test(lower)) out.push('remote');
  return out;
}

// Classify a role into Remote / Hybrid / Onsite / Unknown from any available raw
// location strings (scraper location, evaluation report fields, title, URL).
// Returns { cls, metro } where `metro` is true if the place is in the allowed set.
function classifyLocation(rawStrings) {
  const texts = (rawStrings || []).filter(Boolean).map((s) => String(s).toLowerCase());
  if (!texts.length) return { cls: 'Unknown', metro: false };
  const joined = texts.join(' | ');
  const metro = inAllowedMetro(joined);
  const remoteNegated = /no remote|not remote|remote not|non-remote|remote unavailable/.test(joined);

  if (/\bhybrid\b/.test(joined)) return { cls: 'Hybrid', metro };
  if ((/\bremote\b|work from home|\bwfh\b|remote-first|fully distributed|distributed team/.test(joined)) && !remoteNegated)
    return { cls: 'Remote', metro };
  if (/\bon-?site\b|\bin-office\b|\bin office\b|\bin-person\b|\bin person\b/.test(joined))
    return { cls: 'Onsite', metro };
  // A concrete place (allowed metro, a "City, ST" pair, a known metro, or a full
  // US state name) with no remote/hybrid signal reads as Onsite. The state-name
  // check matters because the jsearch/aggregator digests carry FULL state names
  // ("Bethesda, Maryland", "Pierre, South Dakota"), which the 2-letter pattern
  // misses — those were silently landing in Unknown instead of gating (RCA).
  if (metro || /,\s*[a-z]{2}\b/.test(joined) ||
      /\b(new york|san francisco|bay area|boston|austin|chicago|washington|district of columbia|jersey city|norwalk|atlanta|denver|los angeles|london)\b/.test(joined) ||
      US_STATE_NAMES.test(joined) || isInternational(joined))
    return { cls: 'Onsite', metro };
  return { cls: 'Unknown', metro };
}

// Full US state names (+ DC) — digests carry these rather than 2-letter codes.
const US_STATE_NAMES = /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|west virginia|wisconsin|wyoming|district of columbia)\b/i;

// resolveLocation(job) — precedence order (Task 2d / RCA F1): ATS-API location →
// JSON-LD → URL slug → JD body. Location is a REQUIRED field for publication:
// when nothing resolves to a concrete class, the row is quarantined (G5), never
// published above REVIEW, so an unverified role can't top the APPLY list.
function resolveLocation(job) {
  const signals = [];
  if (job.location) signals.push(String(job.location));            // 1. ATS API / scraper
  if (job.jsonldLocation) signals.push(String(job.jsonldLocation)); // 2. JSON-LD (when page fetched)
  signals.push(...locationFromUrl(job.url));                        // 3. URL slug
  if (job.jd) {                                                     // 4. JD body
    const m = String(job.jd).match(/hybrid|on-?site|in-person|in office|\d+\s*days?\s+a\s+week\s+in/i);
    if (m) signals.push(m[0]);
    const cityState = String(job.jd).match(/\b[A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+)*,\s*[A-Z]{2}\b/);
    if (cityState) signals.push(cityState[0]);
  }
  if (job.title) signals.push(String(job.title));                  // title may carry "(Remote)"
  const { cls, metro } = classifyLocation(signals);
  return { cls, metro, raw: signals.filter(Boolean).join(' | '), resolved: cls !== 'Unknown' };
}

function formatLocationCell(cls, metro) {
  switch (cls) {
    case 'Remote': return '🌐 Remote';
    case 'Hybrid': return metro ? '🏙️ Hybrid (Seattle metro)' : '🏙️ Hybrid';
    case 'Onsite': return metro ? '🏢 Onsite (Seattle metro)' : '🏢 Onsite';
    default: return '📍 Unknown';
  }
}

// True when a row should surface in the main (APPLY/REVIEW) results under the
// remote-only policy: Remote anywhere, or Hybrid inside an allowed metro.
function passesRemotePolicy(row) {
  if (!GEO.remoteOnly) return true;
  return row.locationClass === 'Remote' || (row.locationClass === 'Hybrid' && row.locationMetro);
}

function extractCompanyFromUrl(url) {
  const m = url.match(/weworkremotely\.com\/remote-jobs\/([a-z0-9-]+?)-(director|head|principal|senior|staff|lead|group|product|vp|associate|manager)/i);
  if (m) return m[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/\bUsa\b/, 'USA').replace(/\bAi\b/, 'AI');
  const m2 = url.match(/remote-jobs\/([a-z0-9]+(?:-[a-z0-9]+)?)/i);
  if (m2) return m2[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return '';
}

// ── Extract evaluation scores from reports/ ──

function loadEvaluationScores() {
  const scores = new Map(); // URL → { score, reportFile }
  const reportsDir = join(ROOT, 'reports');
  if (!existsSync(reportsDir)) return scores;

  for (const file of readdirSync(reportsDir).filter(f => f.endsWith('.md'))) {
    const content = readFileSync(join(reportsDir, file), 'utf8');
    const urlMatch = content.match(/^\*\*URL:\*\*\s*(.+)$/m);
    const scoreMatch = content.match(/^\*\*Score:\*\*\s*([\d.]+)\/5/m);
    if (urlMatch && scoreMatch) {
      // Block A "Role Summary" carries free-text Location / Remote fields — pass
      // them through as location signals (best available for evaluated roles).
      const locMatch = content.match(/\|\s*\*\*Location\*\*\s*\|\s*(.+?)\s*\|/);
      const remoteMatch = content.match(/\|\s*\*\*Remote\*\*\s*\|\s*(.+?)\s*\|/);
      const locationHints = [locMatch?.[1], remoteMatch?.[1]].filter(Boolean);
      scores.set(urlMatch[1].trim(), {
        score: parseFloat(scoreMatch[1]),
        reportFile: file,
        locationHints,
      });
    }
  }
  return scores;
}

// ── Parse existing Obsidian table ──

function parseObsidianTable() {
  if (!existsSync(OBSIDIAN_FILE)) return new Map();
  const content = readFileSync(OBSIDIAN_FILE, 'utf8');
  const existing = new Map(); // keyed by URL

  // Row column-splitting + format detection lives in obsidian-table.mjs so that
  // score-and-publish.mjs and reconcile-scores.mjs can't drift. The parser
  // preserves interior empty cells (a blank Adj. or Liveness no longer shifts
  // every later field left by one). See obsidian-table.mjs for the shapes.
  for (const line of content.split('\n')) {
    const row = parseTableRow(line);
    if (row) existing.set(row.url, row);
  }
  return existing;
}

// ── Gather all candidate roles from data sources ──

function gatherNewRoles() {
  const roles = new Map(); // keyed by URL

  // Read ALL digests (or just the latest)
  const dataDir = join(ROOT, 'data');
  if (existsSync(dataDir)) {
    const digestFiles = readdirSync(dataDir)
      .filter(f => f.match(/^new_roles_\d{4}-\d{2}-\d{2}\.md$/))
      .sort()
      .reverse(); // newest first

    const filesToRead = FULL_MODE ? digestFiles : digestFiles.slice(0, 1);

    for (const file of filesToRead) {
      const content = readFileSync(join(dataDir, file), 'utf8');
      for (const line of content.split('\n')) {
        if (!line.startsWith('|') || !line.includes('[View]')) continue;
        const cols = splitTableRow(line);
        if (!/^\d+$/.test(cols[0] || '')) continue; // only the numbered roles table
        const li = cols.findIndex((c) => c.includes('[View]'));
        if (li < 3) continue;
        const urlMatch = line.match(/\[View\]\((.*?)\)\s*\|/);
        if (!urlMatch) continue;
        const url = urlMatch[1].trim();
        let company = (cols[1] || '').trim();
        const title = (cols[2] || '').trim();
        // New digests carry Location before Source+Link (Link at index 5); older
        // digests (Company|Role|Source|Link) put Link at index 4 and have none.
        const location = li >= 5 ? (cols[3] || '').trim() : '';
        if (!company && url.includes('weworkremotely.com')) company = extractCompanyFromUrl(url);
        if (url && !roles.has(url)) roles.set(url, { company, title, url, location });
      }
    }
  }

  // Also read pipeline.md for anything not in a digest
  const pipelinePath = join(ROOT, 'data', 'pipeline.md');
  if (existsSync(pipelinePath)) {
    for (const line of readFileSync(pipelinePath, 'utf8').split('\n')) {
      const m = line.match(/^- \[.\]\s*(https?:\/\/\S+)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*$/);
      if (m) {
        const url = m[1].trim();
        if (!roles.has(url)) roles.set(url, { company: m[2].trim(), title: m[3].trim(), url });
      }
    }
  }

  return roles;
}

// ── Cross-role indexes + per-role evaluation (Scoring Model V2) ─────────────

// Indexes used by legitimacy (G11 JD-hash dedup) and T3→T1 resolution (G12).
function buildIndexes(jobs) {
  const jdHashToCompanies = new Map(); // JD-body hash → Set(company)      (G11)
  const t1Keys = new Set();            // `company|title` of T1 ATS postings (G12)
  for (const j of jobs) {
    if (j.jd) {
      const norm = String(j.jd).replace(/\s+/g, ' ').trim().toLowerCase();
      if (norm) {
        const h = createHash('sha1').update(norm).digest('hex');
        if (!jdHashToCompanies.has(h)) jdHashToCompanies.set(h, new Set());
        jdHashToCompanies.get(h).add(String(j.company || '').toLowerCase().trim());
        j._jdHash = h;
      }
    }
    if (sourceTier(j.url).tier === 1) {
      t1Keys.add(`${String(j.company || '').toLowerCase().trim()}|${String(j.title || '').toLowerCase().trim()}`);
    }
  }
  return { jdHashToCompanies, t1Keys };
}

// resolveLocation → applyGates → computeScore for one role. Pure given `idx`.
function evaluateRole(job, idx = { jdHashToCompanies: new Map(), t1Keys: new Set() }, evalScore) {
  const level = classifyLevel(job.title);
  const loc = resolveLocation(job);
  const src = sourceTier(job.url);
  const jdDupCompanies = job._jdHash ? idx.jdHashToCompanies.get(job._jdHash) : null;
  const gate = applyGates(job, { loc, level, src, jdDupCompanies, t1Index: idx.t1Keys });
  const scored = computeScore(job, { loc, level, compSource: gate.compSource, evalScore });
  // Quarantine / cap_review may NOT sit in APPLY — cap the effective score at
  // REVIEW-max so an unverified/off-track role can never top the list.
  let effective = scored.score;
  if (gate.verdict === 'quarantine' || gate.verdict === 'cap_review') effective = Math.min(effective, 3.9);
  return { level, loc, src, gate, scored, effective, recommendation: getRecommendation(effective) };
}

// ── Main ──

async function main() {
  requireVault();

  const existingRows = parseObsidianTable();
  const candidateRoles = gatherNewRoles();
  const evalScores = RECONCILE_MODE ? loadEvaluationScores() : new Map();

  // Best location signal for a URL: prior-run cell + digest + report hints.
  const locationSignalFor = (url, extra) => {
    const parts = [];
    const prev = existingRows.get(url)?.location;
    if (prev) parts.push(prev);
    if (extra) parts.push(extra);
    const ev = evalScores.get(url);
    if (ev?.locationHints?.length) parts.push(...ev.locationHints);
    return parts.filter(Boolean).join(' | ');
  };

  // Jobs we index + evaluate: open existing rows + genuinely new candidates.
  const jobList = [];
  for (const [url, row] of existingRows) {
    if (LOCKED_STATUSES.includes(row.status)) continue; // locked → never re-gated
    jobList.push({ title: row.role, company: row.company, url, location: locationSignalFor(url) });
  }
  for (const [url, role] of candidateRoles) {
    if (existingRows.has(url)) continue;
    jobList.push({ title: role.title, company: role.company, url, location: locationSignalFor(url, role.location) });
  }
  const idx = buildIndexes(jobList);
  const jobByUrl = new Map(jobList.map(j => [j.url, j]));

  const finalRows = [];
  let newCount = 0, rescoredCount = 0, preservedCount = 0, reconciledCount = 0;

  const makeRow = (job, ev, status, added) => {
    const flags = ev.gate.flags || [];
    const locNote = flags.length ? ` ${flags.join(' · ')}` : '';
    return {
      score: `${ev.scored.score} ${ev.scored.companyLabel}`.trim(),
      stage: ev.scored.stage,
      score_s1: ev.scored.score_s1,
      score_s2: ev.scored.score_s2,
      company: job.company,
      role: job.title,
      level: ev.scored.level,
      domain: ev.scored.domain,
      url: job.url,
      status,
      added,
      recommendation: ev.recommendation,
      companyLabel: ev.scored.companyLabel,
      locationClass: ev.loc.cls,
      locationMetro: ev.loc.metro,
      locationLabel: formatLocationCell(ev.loc.cls, ev.loc.metro) + locNote,
      liveness: undefined,
      _locked: false,
      _numericScore: ev.scored.score,
      _effectiveScore: ev.effective,
      _verdict: ev.gate.verdict,
      _gateReasons: ev.gate.reasons,
      _track: ev.gate.track,
    };
  };

  // Step 1: existing rows — preserve locked, re-evaluate open under gates.
  for (const [url, row] of existingRows) {
    const isLocked = LOCKED_STATUSES.includes(row.status);
    const isOpen = OPEN_STATUSES.includes(row.status);
    const evalScore = (RECONCILE_MODE && evalScores.has(url)) ? evalScores.get(url).score : undefined;

    if (isLocked) {
      // Frozen. Only clean a stale numeric Adj. out of the Stage cell on migration.
      const keepStage = /^S[12]$/.test(row.stage || '') ? row.stage : '';
      finalRows.push({
        score: row.score, stage: keepStage, company: row.company, role: row.role,
        level: row.level, domain: row.domain, url: row.url, status: row.status,
        added: row.added, recommendation: row.status, companyLabel: '',
        locationClass: 'Unknown', locationMetro: false,
        locationLabel: row.location || '📍 Unknown', _locked: true,
      });
      preservedCount++;
    } else if (isOpen || FULL_MODE) {
      const job = jobByUrl.get(url) || { title: row.role, company: row.company, url, location: locationSignalFor(url) };
      const ev = evaluateRole(job, idx, evalScore);
      if (evalScore !== undefined && ev.scored.stage === 'S2') reconciledCount++;
      finalRows.push(makeRow(job, ev, row.status, row.added));
      rescoredCount++;
    } else {
      const keepStage = /^S[12]$/.test(row.stage || '') ? row.stage : '';
      finalRows.push({
        score: row.score, stage: keepStage, company: row.company, role: row.role,
        level: row.level, domain: row.domain, url: row.url, status: row.status, added: row.added,
        recommendation: '🟠 WEAK', companyLabel: '', locationClass: 'Unknown', locationMetro: false,
        locationLabel: row.location || '📍 Unknown', _locked: true,
      });
      preservedCount++;
    }
  }

  // Step 2: genuinely new roles.
  for (const [url, role] of candidateRoles) {
    if (existingRows.has(url)) continue;
    const job = jobByUrl.get(url);
    const evalScore = (RECONCILE_MODE && evalScores.has(url)) ? evalScores.get(url).score : undefined;
    const ev = evaluateRole(job, idx, evalScore);
    if (evalScore !== undefined && ev.scored.stage === 'S2') reconciledCount++;
    finalRows.push(makeRow(job, ev, '🔲 New', TIMESTAMP));
    newCount++;
  }

  // ── Liveness (G10): active APPLY/REVIEW open rows only. Stale → Closed. ──
  let livenessStats = null;
  if (!SKIP_LIVENESS) {
    const toCheck = finalRows.filter(r => !r._locked &&
      (r._verdict === 'pass' || r._verdict === 'cap_review') &&
      (r.recommendation === '🟢 APPLY' || r.recommendation === '🟡 REVIEW') && r.url);
    if (toCheck.length > 0) {
      console.log(`\nChecking liveness for ${toCheck.length} APPLY/REVIEW role(s)...`);
      const { results, stats } = await checkLiveness(toCheck.map(r => r.url), { verbose: VERBOSE_LIVENESS });
      livenessStats = { ...stats, staleFlipped: 0 };
      for (const row of toCheck) {
        const entry = results.get(row.url);
        if (!entry) continue;
        row.liveness = entry;
        if (entry.result === 'stale') {
          const originalAdded = (row.added || '').split(' (stale:')[0].trim();
          row.added = `${originalAdded} (stale: ${entry.reason})`;
          row.status = '❌ Closed';
          row.recommendation = '❌ Closed';
          row._locked = true;
          livenessStats.staleFlipped++;
        }
      }
    }
  }

  // Sort: locked to their own section; open by effective score desc.
  finalRows.sort((a, b) => {
    if (a._locked && !b._locked) return 1;
    if (!a._locked && b._locked) return -1;
    if (a._locked && b._locked) return 0;
    return (b._effectiveScore || 0) - (a._effectiveScore || 0) || a.company.localeCompare(b.company);
  });

  // ── Buckets. A gate-dropped or quarantined role NEVER enters APPLY/REVIEW. ──
  const openRows = finalRows.filter(r => !r._locked);
  const lockedRows = finalRows.filter(r => r._locked);
  const droppedRows = openRows.filter(r => r._verdict === 'drop');
  const quarantineRows = openRows.filter(r => r._verdict === 'quarantine');
  const activeRows = openRows.filter(r => r._verdict === 'pass' || r._verdict === 'cap_review');
  const applyRows = activeRows.filter(r => r.recommendation === '🟢 APPLY');
  const reviewRows = activeRows.filter(r => r.recommendation === '🟡 REVIEW');
  const weakRows = activeRows.filter(r => r.recommendation === '🟠 WEAK');
  const skipRows = activeRows.filter(r => r.recommendation === '⚪ SKIP' || r.recommendation === 'SKIP');

  // ── Build Obsidian markdown ──
  let md = `# Career Ops Scanner — Scored Pipeline\n\n`;
  md += `> Last updated: ${TIMESTAMP} | ${finalRows.length} total roles | `;
  md += `${newCount} new | ${rescoredCount} re-scored | ${preservedCount} preserved | `;
  md += `${droppedRows.length} gate-dropped | ${quarantineRows.length} quarantined\n\n`;

  md += `## Status Legend\n`;
  md += `| Status | Meaning | Editable? |\n`;
  md += `|--------|---------|----------|\n`;
  md += `| 🔲 New | Just discovered, not yet reviewed | Yes — change to any status |\n`;
  md += `| 👀 Reviewing | You're looking at this one | Yes |\n`;
  md += `| ✅ Applied | Application submitted | Locked — won't be re-scored |\n`;
  md += `| ❌ Closed | Listing removed or you passed | Locked |\n`;
  md += `| ⏸️ Paused | Waiting on something | Locked |\n`;
  md += `| 🚫 Rejected | They said no | Locked |\n`;
  md += `| 🎯 Interview | In interview process | Locked |\n`;
  md += `| 🤝 Offer | Offer received | Locked |\n\n`;

  md += `## Scoring Guide — Model V2 (gates + weighted, Brief V1.2)\n`;
  md += `- **Score** = ONE authoritative fit score. **Stage** = how it was produced: \`S1\` deterministic (level gate · location · comp · domain · source · legitimacy), \`S2\` = LLM JD-depth score reconciled from an evaluation report (supersedes S1).\n`;
  md += `- **Gates run BEFORE scoring.** A hard skip — demotion title, comp < $${Math.round(SCORING.comp_floor / 1000)}K, location outside Remote-US / Seattle metro, international, unassisted-coding requirement, off-charter role type, suspect attribution — DROPS or QUARANTINES a role. It can never be out-competed by a strong title.\n`;
  md += `- Level does NOT rank: Sr Manager · Principal · Group PM · Staff · Lead · Director · Head of are equivalent — **content decides**.\n`;
  md += `- 🟢 **APPLY** (4.0+) · 🟡 **REVIEW** (3.0–3.9) · 🟠 **WEAK** (2.0–2.9) · ⚪ **SKIP** (<2.0)\n`;
  md += `- **Location** = 🌐 Remote / 🏙️ Hybrid / 🏢 Onsite / 📍 Unknown\n`;
  if (GEO.remoteOnly) {
    const metroList = GEO.metros.length ? GEO.metros.map(m => m.replace(/\b\w/g, c => c.toUpperCase())).join(', ') : '(none set)';
    md += `- 🌐 **Remote-only is ON**: location is a GATE — only Remote-US + Hybrid/Onsite inside your metro (${metroList}) survive; others drop (G3/G4) or quarantine when unresolved (G5). Set \`geographic.remote_only: false\` in profile.yml to disable location gating.\n`;
  }
  md += `\n`;

  function writeTable(rows, includeStatus = true) {
    if (includeStatus) {
      md += `| Score | Stage | Company | Role | Level | Domain | Location | Link | Status | Liveness | Added |\n`;
      md += `|-------|-------|---------|------|-------|--------|----------|------|--------|----------|-------|\n`;
      for (const r of rows) {
        md += `| ${r.score} | ${r.stage || ''} | ${r.company} | ${r.role} | ${r.level} | ${r.domain} | ${r.locationLabel || '📍 Unknown'} | [View](${r.url}) | ${r.status} | ${formatLivenessCell(r.liveness)} | ${r.added} |\n`;
      }
    } else {
      md += `| Score | Stage | Company | Role | Level | Domain | Location | Link | Added |\n`;
      md += `|-------|-------|---------|------|-------|--------|----------|------|-------|\n`;
      for (const r of rows) {
        md += `| ${r.score} | ${r.stage || ''} | ${r.company} | ${r.role} | ${r.level} | ${r.domain} | ${r.locationLabel || '📍 Unknown'} | [View](${r.url}) | ${r.added} |\n`;
      }
    }
  }

  // Compact table for gated rows — shows the deciding gate(s).
  function writeGateTable(rows) {
    md += `| Score | Company | Role | Location | Gate reason | Link |\n`;
    md += `|-------|---------|------|----------|-------------|------|\n`;
    for (const r of rows) {
      md += `| ${r.score} | ${r.company} | ${r.role} | ${r.locationLabel || '📍 Unknown'} | ${(r._gateReasons || []).join('; ') || '—'} | [View](${r.url}) |\n`;
    }
  }

  if (applyRows.length > 0) {
    md += `## 🟢 Top Matches (${applyRows.length})\n\n`;
    writeTable(applyRows);
    md += '\n';
  }

  if (reviewRows.length > 0) {
    md += `## 🟡 Worth Reviewing (${reviewRows.length})\n\n`;
    writeTable(reviewRows);
    md += '\n';
  }

  if (quarantineRows.length > 0) {
    md += `## ⚠️ Quarantine — verify before trusting (${quarantineRows.length})\n\n`;
    md += `> Location unresolved (G5), suspect employer attribution (G11), or otherwise unverifiable. `;
    md += `Capped below APPLY. Confirm the facts before acting.\n\n`;
    writeGateTable(quarantineRows);
    md += '\n';
  }

  if (droppedRows.length > 0) {
    md += `<details><summary>🚫 Dropped by gate (${droppedRows.length})</summary>\n\n`;
    md += `> Hard-skipped BEFORE scoring — demotion, comp below floor, wrong/international location, coding requirement, off-charter, etc. Shown for transparency; not in the active list.\n\n`;
    writeGateTable(droppedRows);
    md += '\n</details>\n\n';
  }

  if (weakRows.length > 0) {
    md += `<details><summary>🟠 Weak Fit (${weakRows.length})</summary>\n\n`;
    writeTable(weakRows, false);
    md += '\n</details>\n\n';
  }

  if (skipRows.length > 0) {
    md += `<details><summary>⚪ Skipped (${skipRows.length})</summary>\n\n`;
    writeTable(skipRows, false);
    md += '\n</details>\n\n';
  }

  if (lockedRows.length > 0) {
    md += `## 📌 Actioned (${lockedRows.length})\n\n`;
    md += `> These roles have a user-set status and are not re-scored.\n\n`;
    md += `| Score | Stage | Company | Role | Status | Location | Link | Liveness | Added |\n`;
    md += `|-------|-------|---------|------|--------|----------|------|----------|-------|\n`;
    for (const r of lockedRows) {
      md += `| ${r.score} | ${r.stage || ''} | ${r.company} | ${r.role} | ${r.status} | ${r.locationLabel || '📍 Unknown'} | [View](${r.url}) | ${formatLivenessCell(r.liveness)} | ${r.added} |\n`;
    }
    md += '\n';
  }

  // ── Write (dry-run writes a preview; never touches the live scanner) ──
  const outFile = DRY_RUN ? join(ROOT, 'data', 'Career_Ops_Scanner.dryrun.md') : OBSIDIAN_FILE;
  writeFileSync(outFile, md);

  // ── Summary ──
  console.log(`\n━━━ Score & Publish ${DRY_RUN ? '— DRY RUN (live scanner NOT touched)' : ''}━━━`);
  console.log(`Mode:           ${FULL_MODE ? 'full rebuild' : 'incremental'}${RECONCILE_MODE ? ' + reconcile' : ''}`);
  console.log(`New roles:      ${newCount}`);
  console.log(`Re-scored:      ${rescoredCount}`);
  console.log(`Preserved:      ${preservedCount}`);
  if (RECONCILE_MODE) console.log(`Reconciled S2:  ${reconciledCount} (from ${evalScores.size} evaluation reports)`);
  console.log(`Total in table: ${finalRows.length}`);
  console.log(`🟢 APPLY:       ${applyRows.length}`);
  console.log(`🟡 REVIEW:      ${reviewRows.length}`);
  console.log(`⚠️  Quarantine:  ${quarantineRows.length}`);
  console.log(`🚫 Dropped:     ${droppedRows.length}`);
  console.log(`🟠 WEAK:        ${weakRows.length}`);
  console.log(`⚪ SKIP:        ${skipRows.length}`);
  console.log(`📌 Actioned:    ${lockedRows.length}`);

  // Gate-drop breakdown (which gate cut what).
  const dropByGate = {};
  for (const r of droppedRows) { const g = (r._gateReasons[0] || 'G?').split(' ')[0]; dropByGate[g] = (dropByGate[g] || 0) + 1; }
  const quarByGate = {};
  for (const r of quarantineRows) { const g = (r._gateReasons.find(x => /^G/.test(x)) || 'G?').split(' ')[0]; quarByGate[g] = (quarByGate[g] || 0) + 1; }
  if (droppedRows.length) {
    console.log(`\nDropped by gate:`);
    for (const [g, n] of Object.entries(dropByGate).sort((a, b) => b[1] - a[1])) console.log(`  ${g}: ${n}`);
  }
  if (quarantineRows.length) {
    console.log(`Quarantined by gate:`);
    for (const [g, n] of Object.entries(quarByGate).sort((a, b) => b[1] - a[1])) console.log(`  ${g}: ${n}`);
  }

  if (GEO.remoteOnly) {
    const loc = { Remote: 0, Hybrid: 0, Onsite: 0, Unknown: 0 };
    for (const r of finalRows) loc[r.locationClass] = (loc[r.locationClass] || 0) + 1;
    console.log(`\nLocation mix:   🌐 ${loc.Remote} Remote | 🏙️ ${loc.Hybrid} Hybrid | 🏢 ${loc.Onsite} Onsite | 📍 ${loc.Unknown} Unknown  (remote_only ON)`);
  }
  if (livenessStats) {
    console.log(`\nLiveness:       ${livenessStats.checked} checked, ${livenessStats.cacheHits} cached, ${livenessStats.staleFlipped} flipped → ❌ Closed`);
  } else if (SKIP_LIVENESS) {
    console.log(`\nLiveness:       skipped (--skip-liveness)`);
  }

  // New top 10 by score (across the active list) — the dry-run headline.
  const top = [...applyRows, ...reviewRows, ...weakRows]
    .sort((a, b) => (b._effectiveScore || 0) - (a._effectiveScore || 0)).slice(0, 10);
  console.log(`\nNew top ${top.length} by score:`);
  top.forEach((r, i) => console.log(`  ${String(i + 1).padStart(2)}. ${r._effectiveScore} ${r.stage}  ${r.company} — ${r.role}  [${r.locationClass}${r.locationMetro ? '/metro' : ''}]  ${r.recommendation}`));

  console.log(`\n${DRY_RUN ? 'Preview written to' : 'Published to'}: ${outFile}`);
}

// ── Exports (pure functions — imported by test-all.mjs) + main guard ──
export {
  classifyLevel, applyGates, computeScore, resolveLocation, locationFromUrl,
  sourceTier, getRecommendation, contentFitS1, isInternational, classifyLocation,
  evaluateRole, buildIndexes, SCORING,
};

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

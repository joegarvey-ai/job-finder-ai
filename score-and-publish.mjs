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

// OBSIDIAN_VAULT_PATH points to your Obsidian vault root.
const OBSIDIAN_VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH;
const SCANNER_RELATIVE_PATH = process.env.OBSIDIAN_SCANNER_RELATIVE_PATH
  || '02 Personal Projects/Career Collateral/Career_Ops_Scanner.md';

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

const OBSIDIAN_FILE = join(OBSIDIAN_VAULT_PATH, SCANNER_RELATIVE_PATH);

if (!existsSync(OBSIDIAN_VAULT_PATH)) {
  console.error(`OBSIDIAN_VAULT_PATH does not exist: ${OBSIDIAN_VAULT_PATH}`);
  console.error('Check that the path in .env points to your actual Obsidian vault.');
  process.exit(2);
}

const NOW = new Date();
const TODAY = NOW.toISOString().slice(0, 10);
const TIMESTAMP = NOW.toISOString().slice(0, 16).replace('T', ' ');
const FULL_MODE = process.argv.includes('--full');
const RECONCILE_MODE = !process.argv.includes('--no-reconcile');
const SKIP_LIVENESS = process.argv.includes('--skip-liveness');
const VERBOSE_LIVENESS = process.argv.includes('--verbose-liveness');

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

// ── Seniority level scores ─────────────────────────────────────────────────
//
// Load from config/profile.yml under `scoring.level_scores`. Any key present
// there overrides the default below; omitted keys keep their default. Higher =
// surfaced/ranked first. Defaults reflect Joe's targeting: Senior Manager +
// Principal are PRIMARY (5); Director/Head/VP/Senior Director are a STRETCH
// (4.5), so they rank just below. Tune the numbers in profile.yml, not here.

const DEFAULT_LEVEL_SCORES = {
  senior_manager: 5,     // PRIMARY — Senior Manager / Sr. Manager / Senior Group Manager
  principal: 5,          // PRIMARY — Principal / Principal PM
  director_plus: 4.5,    // STRETCH — Director / Head of / VP / Senior Director
  group_pm: 4,           // Group Product Manager
  marketing_ops_lead: 4, // Marketing Operations leadership
  staff: 3.5,            // Staff PM
  lead: 3,               // Lead Product Manager / Senior Lead
  marketing_ops: 2.5,    // Marketing Operations (non-leadership)
  senior_pm: 2,          // Senior Product Manager / Senior PM
  product_manager: 1.5,  // generic PM fallback
  junior: 0,             // associate / intern / contractor / instructor
};

function loadLevelScores() {
  const profilePath = join(ROOT, 'config', 'profile.yml');
  if (!existsSync(profilePath)) return DEFAULT_LEVEL_SCORES;
  try {
    const profile = yaml.load(readFileSync(profilePath, 'utf8')) || {};
    const ls = profile.scoring?.level_scores;
    if (!ls || typeof ls !== 'object') return DEFAULT_LEVEL_SCORES;
    const merged = { ...DEFAULT_LEVEL_SCORES };
    for (const [k, v] of Object.entries(ls)) {
      if (typeof v === 'number' && Number.isFinite(v)) merged[k] = v;
    }
    return merged;
  } catch (err) {
    console.warn(`Warning: could not parse scoring.level_scores from profile.yml (${err.message}). Using defaults.`);
    return DEFAULT_LEVEL_SCORES;
  }
}

const LEVEL_SCORES = loadLevelScores();

function getTitleScore(title) {
  const t = title.toLowerCase();
  const L = LEVEL_SCORES;
  if (t.includes('associate') || t.includes('part-time') || t.includes('intern') ||
      t.includes('instructor') || t.includes('auditor') || t.includes('contractor') ||
      t.includes('independent'))
    return { score: L.junior, level: 'SKIP' };
  if (t.match(/product manager ii\b/) || (t.match(/^product manager[,\s]/) && !t.includes('director') && !t.includes('principal')))
    return { score: 1, level: 'PM' };
  // PRIMARY targets first: Senior Manager (incl. "Sr. Manager"/"Sr Manager"
  // abbreviations) and Principal outrank Director+, which is a stretch.
  if (t.includes('senior manager') || t.includes('senior group manager') ||
      t.match(/\bsr\.?\s+(group\s+)?manager\b/))
    return { score: L.senior_manager, level: 'Sr Manager' };
  if (t.includes('principal'))
    return { score: L.principal, level: 'Principal' };
  if (t.includes('director') || t.includes('head of') || t.match(/\bvp\b/) || t.includes('vice president'))
    return { score: L.director_plus, level: 'Director+' };
  if (t.includes('group product manager'))
    return { score: L.group_pm, level: 'Group PM' };
  if (t.includes('staff'))
    return { score: L.staff, level: 'Staff' };
  if (t.includes('senior lead') || t.includes('lead product manager'))
    return { score: L.lead, level: 'Lead' };
  if (t.includes('senior product manager') || t.includes('senior pm') || t.match(/^sr\.?\s/))
    return { score: L.senior_pm, level: 'Senior PM' };
  if ((t.includes('marketing operations') || t.includes('martech')) &&
      (t.includes('director') || t.includes('head') || t.includes('lead') || t.includes('senior manager')))
    return { score: L.marketing_ops_lead, level: 'MktOps Lead' };
  if (t.includes('marketing operations') || t.includes('martech'))
    return { score: L.marketing_ops, level: 'MktOps' };
  return { score: L.product_manager, level: 'PM' };
}

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
  return { score: Math.max(0, Math.min(3, score)), signals };
}

function getRecommendation(score) {
  if (score === 0) return 'SKIP';
  if (score >= 4.0) return '🟢 APPLY';
  if (score >= 3.0) return '🟡 REVIEW';
  if (score >= 2.0) return '🟠 WEAK';
  return '⚪ SKIP';
}

function computeScore(title, company) {
  const titleInfo = getTitleScore(title);
  const domainInfo = getDomainScore(title, company);
  const companyInfo = getCompanyTier(company);

  let titleNorm = titleInfo.score;
  let domainNorm = domainInfo.score * (5 / 3);
  let companyNorm = companyInfo.tier <= 1 ? 5 : companyInfo.tier <= 2 ? 4 : companyInfo.tier <= 2.5 ? 3.5 : companyInfo.tier <= 3 ? 3 : 2;
  let composite = (titleNorm * 0.4 + domainNorm * 0.4 + companyNorm * 0.2);

  if (titleInfo.score === 0) composite = 0;
  if (titleInfo.level === 'Senior PM' && companyInfo.tier >= 4) composite = Math.min(composite, 2.0);
  // Level floors keyed off the configurable scoring.level_scores. A level weighted
  // >= 5 (PRIMARY — Senior Manager/Principal by default) is floored into APPLY at a
  // tier-1/2 company; a level weighted >= 4.5 (adds STRETCH — Director+) is floored
  // into REVIEW at a tier-1/2.5 company. Re-tune by editing level_scores in profile.yml.
  if (titleInfo.score >= 5 && companyInfo.tier <= 2) composite = Math.max(composite, 4.0);
  if (titleInfo.score >= 4.5 && companyInfo.tier <= 2.5) composite = Math.max(composite, 3.5);

  const recommendation = getRecommendation(composite);

  return {
    score: Math.round(composite * 10) / 10,
    recommendation,
    level: titleInfo.level,
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
function locationFromUrl(url) {
  const out = [];
  if (!url) return out;
  const lower = url.toLowerCase();
  let m = lower.match(/whatjobs\.com\/jobs\/[^/]+\/([^/?#]+)/);
  if (m) out.push(m[1].replace(/-/g, ' '));
  m = url.match(/\/-in-([^/?#]+)/i); // ziprecruiter: /-in-Remote,OR  /-in-Union-City,NJ
  if (m) out.push(m[1].replace(/-/g, ' '));
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
  // A concrete place (allowed metro, a "City, ST" pair, or a known metro) with no
  // remote/hybrid signal reads as Onsite.
  if (metro || /,\s*[a-z]{2}\b/.test(joined) ||
      /\b(new york|san francisco|bay area|boston|austin|chicago|washington|district of columbia|jersey city|norwalk|atlanta|denver|los angeles|london)\b/.test(joined))
    return { cls: 'Onsite', metro };
  return { cls: 'Unknown', metro };
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

// ── Main ──

const existingRows = parseObsidianTable();
const candidateRoles = gatherNewRoles();
const evalScores = RECONCILE_MODE ? loadEvaluationScores() : new Map();

const finalRows = []; // {score, adj, company, role, level, domain, url, status, added, recommendation, companyLabel}
let newCount = 0;
let rescoredCount = 0;
let preservedCount = 0;
let reconciledCount = 0;

// Step 1: Process existing rows — re-score open ones, preserve locked ones
for (const [url, row] of existingRows) {
  const isLocked = LOCKED_STATUSES.includes(row.status);
  const isOpen = OPEN_STATUSES.includes(row.status);

  // Reconcile: if evaluation exists for this URL, use its score as Adj.
  let adj = row.adj || '';
  if (RECONCILE_MODE && evalScores.has(url)) {
    const evalScore = evalScores.get(url).score;
    adj = `${evalScore}`;
    if (adj !== row.adj) reconciledCount++;
  }

  if (isLocked) {
    // Preserve as-is (user took action)
    finalRows.push({
      score: row.score,
      adj,
      company: row.company,
      role: row.role,
      level: row.level,
      domain: row.domain,
      url: row.url,
      status: row.status,
      added: row.added,
      recommendation: row.status, // keep their status as-is
      companyLabel: '', // won't be used for locked rows
      _locked: true,
    });
    preservedCount++;
  } else if (isOpen || FULL_MODE) {
    // Re-score surface score
    const scored = computeScore(row.role, row.company);
    // Effective score for tiering: use Adj. when present, fall back to surface Score
    const effectiveScore = adj ? parseFloat(adj) : scored.score;
    const recommendation = getRecommendation(effectiveScore);
    finalRows.push({
      score: `${scored.score} ${scored.companyLabel}`.trim(),
      adj,
      company: row.company,
      role: row.role,
      level: scored.level,
      domain: scored.domain,
      url: row.url,
      status: row.status, // keep their current open status
      added: row.added,
      recommendation,
      companyLabel: scored.companyLabel,
      _locked: false,
      _numericScore: scored.score,
      _effectiveScore: effectiveScore,
    });
    rescoredCount++;
  } else {
    // Unknown status — preserve
    finalRows.push({
      score: row.score, adj, company: row.company, role: row.role,
      level: row.level, domain: row.domain, url: row.url,
      status: row.status, added: row.added,
      recommendation: '🟠 WEAK', companyLabel: '', _locked: true,
    });
    preservedCount++;
  }
}

// Step 2: Add genuinely new roles (not already in Obsidian)
for (const [url, role] of candidateRoles) {
  if (existingRows.has(url)) continue; // already in table

  const scored = computeScore(role.title, role.company);
  // Check if evaluation already exists for this new role
  let adj = '';
  if (RECONCILE_MODE && evalScores.has(url)) {
    adj = `${evalScores.get(url).score}`;
    reconciledCount++;
  }
  const effectiveScore = adj ? parseFloat(adj) : scored.score;
  const recommendation = getRecommendation(effectiveScore);
  finalRows.push({
    score: `${scored.score} ${scored.companyLabel}`.trim(),
    adj,
    company: role.company,
    role: role.title,
    level: scored.level,
    domain: scored.domain,
    url: role.url,
    status: '🔲 New',
    added: TIMESTAMP,
    recommendation,
    companyLabel: scored.companyLabel,
    _locked: false,
    _numericScore: scored.score,
    _effectiveScore: effectiveScore,
  });
  newCount++;
}

// ── Classify location for every row (Remote / Hybrid / Onsite / Unknown) ──
// Best available signal wins: a prior run's Location cell, the scraper location
// from the digest, the evaluation report's Location/Remote fields, then the role
// title, then hints parsed from the URL. No signal at all → Unknown (never dropped).
for (const r of finalRows) {
  const signals = [];
  const prevLoc = existingRows.get(r.url)?.location;
  if (prevLoc) signals.push(prevLoc);
  const cand = candidateRoles.get(r.url);
  if (cand?.location) signals.push(cand.location);
  const ev = evalScores.get(r.url);
  if (ev?.locationHints?.length) signals.push(...ev.locationHints);
  if (r.role) signals.push(r.role);
  signals.push(...locationFromUrl(r.url));
  const { cls, metro } = classifyLocation(signals);
  r.locationClass = cls;
  r.locationMetro = metro;
  r.locationLabel = formatLocationCell(cls, metro);
}

// ── Liveness check: APPLY/REVIEW open rows only ──
// Run post-scoring, pre-sort so stale rows flip to Closed and settle into the
// Actioned section naturally. See feature spec: we burn time on dead listings
// otherwise (6 of 8 top roles were dead on 2026-04-14).
let livenessStats = null;
if (!SKIP_LIVENESS) {
  const toCheck = finalRows.filter(
    (r) => !r._locked && (r.recommendation === '🟢 APPLY' || r.recommendation === '🟡 REVIEW') && r.url
  );
  if (toCheck.length > 0) {
    console.log(`\nChecking liveness for ${toCheck.length} APPLY/REVIEW role(s)...`);
    const { results, stats } = await checkLiveness(
      toCheck.map((r) => r.url),
      { verbose: VERBOSE_LIVENESS }
    );
    livenessStats = { ...stats, staleFlipped: 0 };

    for (const row of toCheck) {
      const entry = results.get(row.url);
      if (!entry) continue;
      row.liveness = entry;
      if (entry.result === 'stale') {
        // Auto-close: preserve original "added" date but annotate with reason
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

// Sort: locked rows stay grouped at top by status, then open rows by effective score desc
// Effective score = Adj. when present, otherwise surface Score
finalRows.sort((a, b) => {
  // Locked rows with user action go to separate sections
  if (a._locked && !b._locked) return 1;
  if (!a._locked && b._locked) return -1;
  if (a._locked && b._locked) return 0;
  return (b._effectiveScore || 0) - (a._effectiveScore || 0) || a.company.localeCompare(b.company);
});

// ── Build Obsidian markdown ──

const openRows = finalRows.filter(r => !r._locked);
const lockedRows = finalRows.filter(r => r._locked);
const applyCand = openRows.filter(r => r.recommendation === '🟢 APPLY');
const reviewCand = openRows.filter(r => r.recommendation === '🟡 REVIEW');
const weakRows = openRows.filter(r => r.recommendation === '🟠 WEAK');
const skipRows = openRows.filter(r => r.recommendation === '⚪ SKIP' || r.recommendation === 'SKIP');

// Remote-only policy gates the two visible top sections (APPLY + REVIEW).
// Unknown-location roles are NEVER dropped — they go to a "Needs location check"
// bucket. Non-remote roles (Onsite, or Hybrid outside the allowed metro) move to
// a collapsible so nothing disappears. Weak/Skip/Actioned are left untouched.
let applyRows = applyCand;
let reviewRows = reviewCand;
let needsLocationRows = [];
let excludedLocationRows = [];
if (GEO.remoteOnly) {
  const topCand = [...applyCand, ...reviewCand];
  applyRows = applyCand.filter(passesRemotePolicy);
  reviewRows = reviewCand.filter(passesRemotePolicy);
  needsLocationRows = topCand.filter(r => r.locationClass === 'Unknown');
  excludedLocationRows = topCand.filter(r => !passesRemotePolicy(r) && r.locationClass !== 'Unknown');
}

let md = `# Career Ops Scanner — Scored Pipeline\n\n`;
md += `> Last updated: ${TIMESTAMP} | ${finalRows.length} total roles | `;
md += `${newCount} new this run | ${rescoredCount} re-scored | ${preservedCount} preserved\n\n`;

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

md += `## Scoring Guide\n`;
md += `- **Score** = surface score (title + domain + company tier)\n`;
md += `- **Adj.** = adjusted score from JD-depth evaluation (authoritative when present)\n`;
md += `- Tier assignment uses Adj. when available, falls back to Score\n`;
md += `- 🟢 **APPLY** (4.0+): Strong match — apply\n`;
md += `- 🟡 **REVIEW** (3.0-3.9): Good potential, needs JD review\n`;
md += `- 🟠 **WEAK** (2.0-2.9): Level or domain mismatch\n`;
md += `- ⚪ **SKIP** (<2.0): Too junior or hard mismatch\n`;
md += `- **Location** = 🌐 Remote / 🏙️ Hybrid / 🏢 Onsite / 📍 Unknown (best guess from title, URL, scraper + evaluation)\n`;
if (GEO.remoteOnly) {
  const metroList = GEO.metros.length ? GEO.metros.map(m => m.replace(/\b\w/g, c => c.toUpperCase())).join(', ') : '(none set)';
  md += `- 🌐 **Remote-only is ON**: Top Matches & Worth Reviewing show only Remote + Hybrid in your allowed metro (${metroList}). Unknown-location roles wait in **Needs location check**; other Onsite/Hybrid are in **Excluded — not remote**. Set \`geographic.remote_only: false\` in profile.yml for the wider list.\n`;
}
md += `\n`;

function writeTable(rows, includeStatus = true) {
  if (includeStatus) {
    md += `| Score | Adj. | Company | Role | Level | Domain | Location | Link | Status | Liveness | Added |\n`;
    md += `|-------|------|---------|------|-------|--------|----------|------|--------|----------|-------|\n`;
    for (const r of rows) {
      md += `| ${r.score} | ${r.adj || ''} | ${r.company} | ${r.role} | ${r.level} | ${r.domain} | ${r.locationLabel || '📍 Unknown'} | [View](${r.url}) | ${r.status} | ${formatLivenessCell(r.liveness)} | ${r.added} |\n`;
    }
  } else {
    md += `| Score | Adj. | Company | Role | Level | Domain | Location | Link | Added |\n`;
    md += `|-------|------|---------|------|-------|--------|----------|------|-------|\n`;
    for (const r of rows) {
      md += `| ${r.score} | ${r.adj || ''} | ${r.company} | ${r.role} | ${r.level} | ${r.domain} | ${r.locationLabel || '📍 Unknown'} | [View](${r.url}) | ${r.added} |\n`;
    }
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

if (needsLocationRows.length > 0) {
  md += `## 📍 Needs location check (${needsLocationRows.length})\n\n`;
  md += `> These scored as APPLY/REVIEW but their location couldn't be determined. `;
  md += `Remote-only is ON, so they're held here — not dropped. Verify each one's location, then set a status.\n\n`;
  writeTable(needsLocationRows);
  md += '\n';
}

if (excludedLocationRows.length > 0) {
  md += `<details><summary>🌍 Excluded — not remote (${excludedLocationRows.length})</summary>\n\n`;
  md += `> High-scoring but Onsite, or Hybrid outside your allowed metro. Hidden by remote-only. `;
  md += `Set \`geographic.remote_only: false\` in profile.yml to surface these again.\n\n`;
  writeTable(excludedLocationRows);
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
  md += `| Score | Adj. | Company | Role | Status | Location | Link | Liveness | Added |\n`;
  md += `|-------|------|---------|------|--------|----------|------|----------|-------|\n`;
  for (const r of lockedRows) {
    md += `| ${r.score} | ${r.adj || ''} | ${r.company} | ${r.role} | ${r.status} | ${r.locationLabel || '📍 Unknown'} | [View](${r.url}) | ${formatLivenessCell(r.liveness)} | ${r.added} |\n`;
  }
  md += '\n';
}

// Write
writeFileSync(OBSIDIAN_FILE, md);

// Summary
console.log(`\n━━━ Score & Publish ━━━`);
console.log(`Mode:           ${FULL_MODE ? 'full rebuild' : 'incremental'}${RECONCILE_MODE ? ' + reconcile' : ''}`);
console.log(`New roles:      ${newCount}`);
console.log(`Re-scored:      ${rescoredCount}`);
console.log(`Preserved:      ${preservedCount}`);
if (RECONCILE_MODE) {
  console.log(`Reconciled:     ${reconciledCount} (from ${evalScores.size} evaluation reports)`);
}
console.log(`Total in table: ${finalRows.length}`);
console.log(`🟢 APPLY:       ${applyRows.length}${GEO.remoteOnly ? ` (of ${applyCand.length} pre-location)` : ''}`);
console.log(`🟡 REVIEW:      ${reviewRows.length}${GEO.remoteOnly ? ` (of ${reviewCand.length} pre-location)` : ''}`);
if (GEO.remoteOnly) {
  console.log(`📍 Needs loc:   ${needsLocationRows.length} (Unknown location — held, not dropped)`);
  console.log(`🌍 Excluded:    ${excludedLocationRows.length} (Onsite / non-metro Hybrid)`);
}
console.log(`🟠 WEAK:        ${weakRows.length}`);
console.log(`⚪ SKIP:        ${skipRows.length}`);
console.log(`📌 Actioned:    ${lockedRows.length}`);
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
console.log(`\nPublished to: ${OBSIDIAN_FILE}`);

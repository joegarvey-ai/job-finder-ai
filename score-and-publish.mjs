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
// Table columns: Score | Adj. | Company | Role | Level | Domain | Link | Status | Added
//
// Usage:
//   node score-and-publish.mjs              # Incremental + reconcile (default)
//   node score-and-publish.mjs --full       # Re-score everything from pipeline + all digests
//   node score-and-publish.mjs --no-reconcile # Skip evaluation score reconciliation

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { checkLiveness, formatLivenessCell } from './liveness-http.mjs';

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

function getTitleScore(title) {
  const t = title.toLowerCase();
  if (t.includes('associate') || t.includes('part-time') || t.includes('intern') ||
      t.includes('instructor') || t.includes('auditor') || t.includes('contractor') ||
      t.includes('independent'))
    return { score: 0, level: 'SKIP' };
  if (t.match(/product manager ii\b/) || (t.match(/^product manager[,\s]/) && !t.includes('director') && !t.includes('principal')))
    return { score: 1, level: 'PM' };
  if (t.includes('director') || t.includes('head of') || t.match(/\bvp\b/) || t.includes('vice president'))
    return { score: 5, level: 'Director+' };
  if (t.includes('principal'))
    return { score: 4.5, level: 'Principal' };
  if (t.includes('group product manager'))
    return { score: 4, level: 'Group PM' };
  if (t.includes('staff'))
    return { score: 3.5, level: 'Staff' };
  if (t.includes('senior lead') || t.includes('lead product manager'))
    return { score: 3, level: 'Lead' };
  if (t.includes('senior manager') || t.includes('senior group manager'))
    return { score: 4, level: 'Sr Manager' };
  if (t.includes('senior product manager') || t.includes('senior pm') || t.match(/^sr\.?\s/))
    return { score: 2, level: 'Senior PM' };
  if ((t.includes('marketing operations') || t.includes('martech')) &&
      (t.includes('director') || t.includes('head') || t.includes('lead') || t.includes('senior manager')))
    return { score: 4, level: 'MktOps Lead' };
  if (t.includes('marketing operations') || t.includes('martech'))
    return { score: 2.5, level: 'MktOps' };
  return { score: 1.5, level: 'PM' };
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
      scores.set(urlMatch[1].trim(), {
        score: parseFloat(scoreMatch[1]),
        reportFile: file,
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

  for (const line of content.split('\n')) {
    // Extract URL from any table row containing [View](URL)
    // Match [View](URL) requiring `)` followed by table cell delimiter `|`,
    // so URLs containing literal parens (ZipRecruiter `(USA)`,
    // `(Business-Cards-&-Payments)`, etc.) aren't truncated at the first inner `)`.
    const urlMatch = line.match(/\[View\]\((.*?)\)\s*\|/);
    if (!urlMatch || !line.startsWith('|')) continue;

    const url = urlMatch[1].trim();
    const cols = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cols.length < 5) continue;

    // Detect format by column count:
    //   9 cols: Score | Adj. | Company | Role | Level | Domain | Link | Status | Added
    //   8 cols: Score | Adj. | Company | Role | Level | Domain | Link | Added (no status — collapsed)
    //        OR Score | Company | Role | Level | Domain | Link | Status | Added (legacy, no Adj.)
    //   7 cols: Score | Company | Role | Level | Domain | Link | Added (legacy collapsed)
    //   6 cols: Score | Company | Role | Status | Link | Added (actioned section)
    let adj = '';
    let status = '🔲 New';
    let added = '';
    let company, role, level, domain;

    // Determine if this row has the Adj. column by checking if col[1] looks like
    // a score (number with optional /5) or is empty (blank adj).
    // Works for both full rows (9 cols) and actioned rows (7 cols with Adj.)
    const adjLike = cols[1] === '' || cols[1] === '—' || cols[1].match(/^[\d.]+(?:\/5)?$/);
    const hasAdj = adjLike && cols.length >= 7;

    if (hasAdj && cols.length >= 10) {
      // Full + Liveness: Score | Adj. | Company | Role | Level | Domain | Link | Status | Liveness | Added
      adj = cols[1] || '';
      company = cols[2] || '';
      role = cols[3] || '';
      level = cols[4] || '';
      domain = cols[5] || '';
      status = cols[7] || '🔲 New';
      added = cols[9] || '';
    } else if (hasAdj && cols.length === 9) {
      // Full new format: Score | Adj. | Company | Role | Level | Domain | Link | Status | Added
      adj = cols[1] || '';
      company = cols[2] || '';
      role = cols[3] || '';
      level = cols[4] || '';
      domain = cols[5] || '';
      status = cols[7] || '🔲 New';
      added = cols[8] || '';
    } else if (hasAdj && cols.length === 8) {
      // Two possible 8-col shapes, disambiguated by Link column position:
      //   A) Actioned + Liveness: Score | Adj. | Company | Role | Status | Link | Liveness | Added
      //   B) Collapsed new:       Score | Adj. | Company | Role | Level | Domain | Link | Added
      const linkIdx = cols.findIndex((c) => c.includes('[View]'));
      if (linkIdx === 5) {
        // Shape A
        adj = cols[1] || '';
        company = cols[2] || '';
        role = cols[3] || '';
        level = '';
        domain = '';
        status = cols[4] || '';
        added = cols[7] || '';
      } else {
        // Shape B
        adj = cols[1] || '';
        company = cols[2] || '';
        role = cols[3] || '';
        level = cols[4] || '';
        domain = cols[5] || '';
        if (cols[7].match(/^\d{4}-\d{2}-\d{2}/)) {
          added = cols[7];
        } else {
          status = cols[7];
        }
      }
    } else if (hasAdj && cols.length === 7) {
      // Actioned new format: Score | Adj. | Company | Role | Status | Link | Added
      adj = cols[1] || '';
      company = cols[2] || '';
      role = cols[3] || '';
      level = '';
      domain = '';
      status = cols[4] || '';
      added = cols[6] || '';
    } else if (cols.length >= 8) {
      // Legacy full: Score | Company | Role | Level | Domain | Link | Status | Added
      company = cols[1] || '';
      role = cols[2] || '';
      level = cols[3] || '';
      domain = cols[4] || '';
      status = cols[6] || '🔲 New';
      added = cols[7] || '';
    } else if (cols.length === 7) {
      // Legacy collapsed: Score | Company | Role | Level | Domain | Link | Added
      company = cols[1] || '';
      role = cols[2] || '';
      level = cols[3] || '';
      domain = cols[4] || '';
      if (cols[6].match(/^\d{4}-\d{2}-\d{2}/)) {
        added = cols[6];
      } else {
        status = cols[6];
      }
    } else if (cols.length === 6) {
      // Legacy actioned: Score | Company | Role | Status | Link | Added
      company = cols[1] || '';
      role = cols[2] || '';
      level = '';
      domain = '';
      status = cols[3] || '';
      added = cols[5] || '';
    }

    // Clean status — strip any [View](...) remnants from column parsing
    status = status.replace(/\[View\].*/, '').trim() || '🔲 New';
    added = added.replace(/\[View\].*/, '').trim();

    existing.set(url, {
      score: cols[0] || '',
      adj,
      company,
      role,
      level,
      domain,
      url,
      status,
      added,
    });
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
        const m = line.match(/^\|\s*\d+\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*\[View\]\((.*?)\)\s*\|/);
        if (!m) continue;
        let company = m[1].trim();
        const title = m[2].trim();
        const url = m[4].trim();
        if (!company && url.includes('weworkremotely.com')) company = extractCompanyFromUrl(url);
        if (url && !roles.has(url)) roles.set(url, { company, title, url });
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
const applyRows = openRows.filter(r => r.recommendation === '🟢 APPLY');
const reviewRows = openRows.filter(r => r.recommendation === '🟡 REVIEW');
const weakRows = openRows.filter(r => r.recommendation === '🟠 WEAK');
const skipRows = openRows.filter(r => r.recommendation === '⚪ SKIP' || r.recommendation === 'SKIP');

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
md += `- ⚪ **SKIP** (<2.0): Too junior or hard mismatch\n\n`;

function writeTable(rows, includeStatus = true) {
  if (includeStatus) {
    md += `| Score | Adj. | Company | Role | Level | Domain | Link | Status | Liveness | Added |\n`;
    md += `|-------|------|---------|------|-------|--------|------|--------|----------|-------|\n`;
    for (const r of rows) {
      md += `| ${r.score} | ${r.adj || ''} | ${r.company} | ${r.role} | ${r.level} | ${r.domain} | [View](${r.url}) | ${r.status} | ${formatLivenessCell(r.liveness)} | ${r.added} |\n`;
    }
  } else {
    md += `| Score | Adj. | Company | Role | Level | Domain | Link | Added |\n`;
    md += `|-------|------|---------|------|-------|--------|------|-------|\n`;
    for (const r of rows) {
      md += `| ${r.score} | ${r.adj || ''} | ${r.company} | ${r.role} | ${r.level} | ${r.domain} | [View](${r.url}) | ${r.added} |\n`;
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
  md += `| Score | Adj. | Company | Role | Status | Link | Liveness | Added |\n`;
  md += `|-------|------|---------|------|--------|------|----------|-------|\n`;
  for (const r of lockedRows) {
    md += `| ${r.score} | ${r.adj || ''} | ${r.company} | ${r.role} | ${r.status} | [View](${r.url}) | ${formatLivenessCell(r.liveness)} | ${r.added} |\n`;
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
console.log(`🟢 APPLY:       ${applyRows.length}`);
console.log(`🟡 REVIEW:      ${reviewRows.length}`);
console.log(`🟠 WEAK:        ${weakRows.length}`);
console.log(`⚪ SKIP:        ${skipRows.length}`);
console.log(`📌 Actioned:    ${lockedRows.length}`);
if (livenessStats) {
  console.log(`\nLiveness:       ${livenessStats.checked} checked, ${livenessStats.cacheHits} cached, ${livenessStats.staleFlipped} flipped → ❌ Closed`);
} else if (SKIP_LIVENESS) {
  console.log(`\nLiveness:       skipped (--skip-liveness)`);
}
console.log(`\nPublished to: ${OBSIDIAN_FILE}`);

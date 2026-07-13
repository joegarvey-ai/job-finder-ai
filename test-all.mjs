#!/usr/bin/env node

/**
 * test-all.mjs — Comprehensive test suite for career-ops
 *
 * Run before merging any PR or pushing changes.
 * Tests: syntax, scripts, dashboard, data contract, personal data, paths.
 *
 * Usage:
 *   node test-all.mjs           # Run all tests
 *   node test-all.mjs --quick   # Skip dashboard build (faster)
 */

import { execSync, execFileSync } from 'child_process';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const QUICK = process.argv.includes('--quick');
const NODE = process.execPath;

let passed = 0;
let failed = 0;
let warnings = 0;

function pass(msg) { console.log(`  ✅ ${msg}`); passed++; }
function fail(msg) { console.log(`  ❌ ${msg}`); failed++; }
function warn(msg) { console.log(`  ⚠️  ${msg}`); warnings++; }

function run(cmd, args = [], opts = {}) {
  try {
    if (Array.isArray(args) && args.length > 0) {
      return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf-8', timeout: 30000, ...opts }).trim();
    }
    return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', timeout: 30000, ...opts }).trim();
  } catch (e) {
    return null;
  }
}

function fileExists(path) { return existsSync(join(ROOT, path)); }
function readFile(path) { return readFileSync(join(ROOT, path), 'utf-8'); }

console.log('\n🧪 career-ops test suite\n');

// ── 1. SYNTAX CHECKS ────────────────────────────────────────────

console.log('1. Syntax checks');

const mjsFiles = readdirSync(ROOT).filter(f => f.endsWith('.mjs'));
for (const f of mjsFiles) {
  const result = run(NODE, ['--check', f]);
  if (result !== null) {
    pass(`${f} syntax OK`);
  } else {
    fail(`${f} has syntax errors`);
  }
}

// ── 2. SCRIPT EXECUTION ─────────────────────────────────────────

console.log('\n2. Script execution (graceful on empty data)');

const scripts = [
  { name: 'cv-sync-check.mjs', expectExit: 1, allowFail: true }, // fails without cv.md (normal in repo)
  { name: 'verify-pipeline.mjs', expectExit: 0 },
  { name: 'normalize-statuses.mjs', expectExit: 0 },
  { name: 'dedup-tracker.mjs', expectExit: 0 },
  { name: 'merge-tracker.mjs', expectExit: 0 },
  { name: 'analyze-patterns.mjs --self-test', expectExit: 0 },
  { name: 'update-system.mjs check', expectExit: 0 },
];

for (const { name, allowFail } of scripts) {
  const result = run(NODE, name.split(' '), { stdio: ['pipe', 'pipe', 'pipe'] });
  if (result !== null) {
    pass(`${name} runs OK`);
  } else if (allowFail) {
    warn(`${name} exited with error (expected without user data)`);
  } else {
    fail(`${name} crashed`);
  }
}

// ── 3. URL EXTRACTION REGEX ─────────────────────────────────────

console.log('\n3. URL extraction (paren-in-URL safety)');

// Same regex used by reconcile-scores.mjs and score-and-publish.mjs.
// Test ensures URLs with literal parens (ZipRecruiter, Walmart, etc.)
// are not truncated at the first inner `)`.
const URL_REGEX = /\[View\]\((.*?)\)\s*\|/;

const urlTests = [
  {
    name: 'ZipRecruiter URL with (Business-Cards) parens',
    line: '| 4.0 |  | Capital One | Sr Mgr | Director | AI/ML | [View](https://www.ziprecruiter.com/c/Capital-One/Job/Sr-Mgr-(Business-Cards-&-Payments)/-in-McLean,VA?jid=abc123) | 🔲 New | — | 2026-04-30 |',
    expected: 'https://www.ziprecruiter.com/c/Capital-One/Job/Sr-Mgr-(Business-Cards-&-Payments)/-in-McLean,VA?jid=abc123',
  },
  {
    name: 'ZipRecruiter URL with (USA) prefix',
    line: '| 3.5 |  | Walmart | Principal | Director | Data | [View](https://www.ziprecruiter.com/c/Walmart/Job/(USA)-Principal,-PM/-in-Union-City,NJ?jid=xyz) | 🔲 New | — | 2026-04-30 |',
    expected: 'https://www.ziprecruiter.com/c/Walmart/Job/(USA)-Principal,-PM/-in-Union-City,NJ?jid=xyz',
  },
  {
    name: 'ZipRecruiter URL with (Florida or Chicago preferred) parens',
    line: '| 3.7 |  | Mabbly | Head of Product | Director+ | AI/ML | [View](https://www.ziprecruiter.com/c/Mabbly/Job/Head-of-Product-Remote-(Florida-or-Chicago-preferred)/-in-Fort-Lauderdale,FL?jid=def) | 🔲 New | — | 2026-04-30 |',
    expected: 'https://www.ziprecruiter.com/c/Mabbly/Job/Head-of-Product-Remote-(Florida-or-Chicago-preferred)/-in-Fort-Lauderdale,FL?jid=def',
  },
  {
    name: 'Plain URL with no parens (regression)',
    line: '| 4.4 |  | Schneider | Director | Director+ | AI/ML | [View](https://www.whatjobs.com/jobs/director-ai-marketing-ops?id=2640575527) | 🔲 New | — | 2026-04-30 |',
    expected: 'https://www.whatjobs.com/jobs/director-ai-marketing-ops?id=2640575527',
  },
  {
    name: 'Greenhouse URL with query string (regression)',
    line: '| 3.7 |  | Klaviyo | Director MO | Director+ | MarTech | [View](https://www.klaviyo.com/careers/jobs?gh_jid=7700798003) | 🔲 New | — | 2026-04-30 |',
    expected: 'https://www.klaviyo.com/careers/jobs?gh_jid=7700798003',
  },
  {
    name: 'LinkedIn URL with hyphenated path (regression)',
    line: '| 3.7 | 1.5 | A1 | Head of Product, AI | Director+ | AI/ML | [View](https://www.linkedin.com/jobs/view/head-of-product-ai-at-a1-4405720578) | 🔲 New | 🟢 Live | 2026-04-30 03:07 |',
    expected: 'https://www.linkedin.com/jobs/view/head-of-product-ai-at-a1-4405720578',
  },
];

for (const t of urlTests) {
  const m = t.line.match(URL_REGEX);
  const got = m ? m[1] : null;
  if (got === t.expected) {
    pass(t.name);
  } else {
    fail(`${t.name}: got "${got}", expected "${t.expected}"`);
  }
}

// ── 3b. OBSIDIAN TABLE PARSING (regression) ─────────────────────
//
// Row column-splitting + format detection lives in obsidian-table.mjs, shared
// by reconcile-scores.mjs and score-and-publish.mjs.
//
// Two historical bugs are guarded here:
//   (1) Actioned rows are 7 cols with an Adj. column
//       (Score | Adj. | Company | Role | Status | Link | Added). A `>= 8`
//       threshold misclassified them as missing Adj. and spliced a duplicate.
//       The correct threshold is `>= 7`.
//   (2) Splitting a row with `.split('|').map(trim).filter(Boolean)` dropped
//       INTERIOR empty cells too, so a blank Adj. (or blank Liveness) collapsed
//       the row by a column and shifted every later field left — Liveness
//       landed in Added, Adj. was lost, and the row was misread as a legacy
//       no-Adj format. splitTableRow preserves interior empties.

console.log('\n3b. Obsidian table parsing');

const { splitTableRow, parseTableRow } = await import(
  pathToFileURL(join(ROOT, 'obsidian-table.mjs')).href
);

const reconcileSrc = readFile('reconcile-scores.mjs');
const obsidianTableSrc = readFile('obsidian-table.mjs');
const scorePublishSrc = readFile('score-and-publish.mjs');

if (/cols\.length\s*>=\s*7/.test(reconcileSrc) && !/cols\.length\s*>=\s*8/.test(reconcileSrc)) {
  pass('reconcile-scores.mjs hasAdj threshold is >= 7 (actioned-row safe)');
} else {
  fail('reconcile-scores.mjs uses wrong hasAdj threshold — actioned rows will get duplicate Adj. column');
}

if (/cols\.length\s*>=\s*7/.test(obsidianTableSrc)) {
  pass('obsidian-table.mjs hasAdj threshold is >= 7 (actioned-row safe)');
} else {
  fail('obsidian-table.mjs hasAdj threshold has drifted — actioned-row detection may be broken');
}

// Guard against reintroducing the column-shift bug: no table-row split may pipe
// straight into filter(Boolean), which drops interior blank cells.
const splitSafe = (src) => !/split\(\s*['"]\|['"]\s*\)[\s\S]{0,80}?filter\(\s*Boolean\s*\)/.test(src);
if (splitSafe(reconcileSrc) && splitSafe(scorePublishSrc) && splitSafe(obsidianTableSrc)) {
  pass('No filter(Boolean) row-splitting (interior blank cells preserved)');
} else {
  fail('filter(Boolean) row-splitting reintroduced — blank Adj./Liveness cells will shift columns');
}

// Logic simulation — what counts as having a Stage column. MUST stay in sync
// with parseTableRow in obsidian-table.mjs. The second cell is a Stage column
// when it is empty / '—' / an S1|S2 marker / or a legacy numeric Adj. score
// (which migrates cleanly on one read).
function hasStageColumn(cols) {
  const stageLike = cols[1] === '' || cols[1] === '—' || /^S[12]$/i.test(cols[1]) || /^[\d.]+(?:\/5)?$/.test(cols[1]);
  return stageLike && cols.length >= 7;
}

const stageFixtures = [
  // [description, table-line, expected-hasStage]
  [
    'Actioned row with S2 stage (7 cols)',
    '| 4.4 | S2 | Schneider Electric | Director, AI Ops | 🟢 Live | [View](https://example.com/x) | — |',
    true,
  ],
  [
    'Actioned row with legacy numeric Adj. (7 cols) — migrates cleanly',
    '| 4.4 | 2.8 | Schneider Electric | Director, AI Ops | 🟢 Live | [View](https://example.com/x) | — |',
    true,
  ],
  [
    'Full row with S1 stage + Liveness (10 cols)',
    '| 4.4 | S1 | Datadog | Director PM | Director+ | AI/ML | [View](https://example.com/y) | 🔲 New | 🟢 Live | 2026-05-17 |',
    true,
  ],
  [
    // Interior empties preserved: a blank Stage row keeps its 10 cols and
    // col[1] === '' is recognized as the (empty) Stage column. Under the old
    // filter(Boolean) split this collapsed to false.
    'Full row with BLANK Stage + Liveness (10 cols)',
    '| 4.0 🏆 T1 |  | Anthropic | Head of Product | Director+ | AI/ML | [View](https://example.com/z) | 🔲 New | 🟢 Live (2026-05-25) | 2026-05-20 14:30 |',
    true,
  ],
  [
    'Legacy row, no Stage column (Company in col[1])',
    '| 4.4 | Datadog | Director PM | Director+ | AI/ML | [View](https://example.com/y) | 🔲 New | 2026-05-17 |',
    false,
  ],
];

for (const [name, line, expected] of stageFixtures) {
  const cols = splitTableRow(line);
  const got = hasStageColumn(cols);
  if (got === expected) {
    pass(`hasStage fixture: ${name}`);
  } else {
    fail(`hasStage fixture: ${name} — got ${got}, expected ${expected}`);
  }
}

// splitTableRow must keep interior empties (the core of the column-shift fix).
const blankStageRow = '| 4.0 🏆 T1 |  | Anthropic | Head of Product | Director+ | AI/ML | [View](https://job-boards.greenhouse.io/anthropic/jobs/123) | 🔲 New | 🟢 Live (2026-05-25) | 2026-05-20 14:30 |';
const cols10 = splitTableRow(blankStageRow);
if (cols10.length === 10 && cols10[1] === '') {
  pass('splitTableRow preserves interior blank Stage cell (10 cols, col[1] empty)');
} else {
  fail(`splitTableRow dropped interior blank: length=${cols10.length}, col[1]="${cols10[1]}"`);
}

// Core regression: blank Stage + populated Liveness survives parse → write →
// parse with Added intact, Stage still blank, Status correct, and no shift.
const p1 = parseTableRow(blankStageRow);
const liveness = '🟢 Live (2026-05-25)';
const reserialize = (r) =>
  `| ${r.score} | ${r.stage || ''} | ${r.company} | ${r.role} | ${r.level} | ${r.domain} | ${r.location || '📍 Unknown'} | [View](${r.url}) | ${r.status} | ${liveness} | ${r.added} |`;
const p2 = p1 ? parseTableRow(reserialize(p1)) : null;

const okFirst = p1 && p1.stage === '' && p1.added === '2026-05-20 14:30' &&
  p1.status === '🔲 New' && p1.score === '4.0 🏆 T1' && p1.company === 'Anthropic' &&
  p1.url === 'https://job-boards.greenhouse.io/anthropic/jobs/123';
const stable = p2 && p2.stage === p1.stage && p2.added === p1.added && p2.status === p1.status &&
  p2.company === p1.company && p2.url === p1.url && p2.role === p1.role;
if (okFirst && stable) {
  pass('Blank-Stage + Liveness row survives parse→write→parse (no column shift)');
} else {
  fail(`Blank-Stage round-trip broke: p1=${JSON.stringify(p1)} p2=${JSON.stringify(p2)}`);
}

// S2 stage marker survives a round-trip (new schema).
const s2Row = '| 4.2 ⭐ T2 | S2 | Meridian Labs | Head of Product | Director+ | AI/ML | 🌐 Remote | [View](https://job-boards.greenhouse.io/meridianlabs/jobs/9) | 🔲 New | 🟢 Live (2026-07-11) | 2026-07-11 09:00 |';
const ps2 = parseTableRow(s2Row);
if (ps2 && ps2.stage === 'S2' && ps2.company === 'Meridian Labs' && ps2.score === '4.2 ⭐ T2' && ps2.added === '2026-07-11 09:00') {
  pass('S2 Stage marker parses (Score/Company/Added aligned)');
} else {
  fail(`S2 Stage row parse broke: ${JSON.stringify(ps2)}`);
}

// Legacy 10-col row (no Location column) must still parse, with location === ''.
if (p1 && p1.location === '') {
  pass('Legacy row (no Location column) parses with empty location');
} else {
  fail(`Legacy row should have empty location, got "${p1 && p1.location}"`);
}

// New-schema fixtures: Location sits before Link. Verify every field — especially
// Adj. and Added — lands correctly for each shape the writer now emits.
const schemaFixtures = [
  {
    name: 'Full + legacy numeric Adj → migrates to empty Stage (11 cols)',
    line: '| 4.4 | 3.8 | Datadog | Director PM | Director+ | AI/ML | 🌐 Remote | [View](https://example.com/y) | 🔲 New | 🟢 Live (2026-07-01) | 2026-07-01 09:00 |',
    expect: { score: '4.4', stage: '', company: 'Datadog', role: 'Director PM', level: 'Director+', domain: 'AI/ML', location: '🌐 Remote', status: '🔲 New', added: '2026-07-01 09:00' },
  },
  {
    name: 'Full + BLANK Stage + Location (11 cols)',
    line: '| 4.0 🏆 T1 |  | Anthropic | Head of Product | Director+ | AI/ML | 🏙️ Hybrid (Seattle metro) | [View](https://example.com/z) | 🔲 New | 🟢 Live (2026-07-01) | 2026-07-01 09:00 |',
    expect: { stage: '', company: 'Anthropic', level: 'Director+', location: '🏙️ Hybrid (Seattle metro)', status: '🔲 New', added: '2026-07-01 09:00' },
  },
  {
    name: 'Actioned + Location + Liveness (9 cols)',
    line: '| 4 ⭐ T2 |  | Figma | Director, Product | ✅ Applied | 🏢 Onsite | [View](https://example.com/f) | 🟢 Live (2026-07-01) | 2026-05-28 |',
    expect: { stage: '', company: 'Figma', role: 'Director, Product', status: '✅ Applied', location: '🏢 Onsite', added: '2026-05-28' },
  },
  {
    name: 'Weak/Skip + Location, no Status (9 cols)',
    line: '| 2.5 |  | Acme | Senior PM | Senior PM | Data | 📍 Unknown | [View](https://example.com/a) | 2026-06-01 |',
    expect: { stage: '', company: 'Acme', level: 'Senior PM', location: '📍 Unknown', status: '🔲 New', added: '2026-06-01' },
  },
];

for (const fx of schemaFixtures) {
  const r = parseTableRow(fx.line);
  const bad = r ? Object.entries(fx.expect).filter(([k, v]) => r[k] !== v) : [['<null>', 'row']];
  if (r && bad.length === 0) {
    pass(`parseTableRow: ${fx.name}`);
  } else {
    fail(`parseTableRow: ${fx.name} — mismatches: ${JSON.stringify(bad)} (got ${JSON.stringify(r)})`);
  }
}

// ── 4. LIVENESS CLASSIFICATION ──────────────────────────────────

console.log('\n4. Liveness classification');

try {
  const { classifyLiveness } = await import(pathToFileURL(join(ROOT, 'liveness-core.mjs')).href);

  const expiredChromeApply = classifyLiveness({
    finalUrl: 'https://example.com/jobs/closed-role',
    bodyText: 'Company Careers\nApply\nThe job you are looking for is no longer open.',
    applyControls: [],
  });
  if (expiredChromeApply.result === 'expired') {
    pass('Expired pages are not revived by nav/footer "Apply" text');
  } else {
    fail(`Expired page misclassified as ${expiredChromeApply.result}`);
  }

  const activeWorkdayPage = classifyLiveness({
    finalUrl: 'https://example.workday.com/job/123',
    bodyText: [
      '663 JOBS FOUND',
      'Senior AI Engineer',
      'Join our applied AI team to ship production systems, partner with customers, and own delivery across evaluation, deployment, and reliability.',
    ].join('\n'),
    applyControls: ['Apply for this Job'],
  });
  if (activeWorkdayPage.result === 'active') {
    pass('Visible apply controls still keep real job pages active');
  } else {
    fail(`Active job page misclassified as ${activeWorkdayPage.result}`);
  }

  const closedMycareersfuture = classifyLiveness({
    finalUrl: 'https://www.mycareersfuture.gov.sg/job/engineering/senior-staff-embedded-software-engineer',
    bodyText: [
      'Senior Staff Embedded Software Engineer',
      'MaxLinear Asia Singapore Private Limited',
      '9 applications    Posted 27 Oct 2025    Closed on 26 Nov 2025',
      'Applications have closed for this job',
      'Log in to Apply',
      "You'll need to log in with Singpass to verify your identity.",
      'Roles & Responsibilities: design, develop and maintain embedded firmware for broadband communications ICs.',
    ].join('\n'),
    applyControls: ['Log in to Apply'],
  });
  if (closedMycareersfuture.result === 'expired') {
    pass('Closed postings with "Applications have closed" banner are detected');
  } else {
    fail(`Closed mycareersfuture posting misclassified as ${closedMycareersfuture.result}`);
  }
} catch (e) {
  fail(`Liveness classification tests crashed: ${e.message}`);
}

// ── 5. LIVENESS HTTP CHECKER ───────────────────────────────

console.log('\n5. Liveness HTTP checker');

try {
  const { _internals, formatLivenessCell } = await import(
    pathToFileURL(join(ROOT, 'liveness-http.mjs')).href
  );
  const { isGenericCareersRedirect, extractPostingAgeDays, classifyHttpLiveness, isAggregatorUrl } = _internals;

  // ---- isGenericCareersRedirect ----

  if (isGenericCareersRedirect(
    'https://acme.com/jobs/12345',
    'https://acme.com/careers'
  ) === true) {
    pass('Detects redirect from job ID to /careers root');
  } else {
    fail('Should detect redirect from job ID to /careers root');
  }

  if (isGenericCareersRedirect(
    'https://boards.greenhouse.io/acme/jobs/12345',
    'https://boards.greenhouse.io/acme/jobs'
  ) === true) {
    pass('Detects Greenhouse redirect from /jobs/ID to /jobs');
  } else {
    fail('Should detect Greenhouse redirect from /jobs/ID to /jobs');
  }

  if (isGenericCareersRedirect(
    'https://acme.com/jobs/12345',
    'https://acme.com/jobs/12345'
  ) === false) {
    pass('Same URL is not a redirect');
  } else {
    fail('Same URL should not be flagged as redirect');
  }

  if (isGenericCareersRedirect(
    'https://acme.com/jobs/12345',
    'https://acme.com/jobs/67890'
  ) === false) {
    pass('Different job ID is not a generic careers redirect');
  } else {
    fail('Different job ID should not be flagged as generic redirect');
  }

  // Job ID in the QUERY string (Greenhouse gh_jid): a redirect that drops it and
  // lands on a bare /jobs index is stale — the ID lived in the query, not the path.
  if (isGenericCareersRedirect(
    'https://careers.example.com/jobs?gh_jid=123',
    'https://careers.example.com/jobs'
  ) === true) {
    pass('Detects redirect that drops a query-string job ID (?gh_jid) to /jobs');
  } else {
    fail('Should detect redirect dropping a query-string job ID to bare /jobs');
  }

  if (isGenericCareersRedirect(
    'https://boards.greenhouse.io/acme/jobs?gh_jid=1',
    'https://boards.greenhouse.io/acme/jobs?gh_jid=2'
  ) === false) {
    pass('Redirect to a different query-string job ID is not a generic redirect');
  } else {
    fail('A final URL that still carries a query-string job ID should not be flagged');
  }

  // ---- extractPostingAgeDays ----

  if (extractPostingAgeDays('Posted 14 days ago') === 14) {
    pass('Parses "Posted N days ago" pattern');
  } else {
    fail('Should parse "Posted N days ago" pattern');
  }

  // datePosted JSON-LD: 30 days ago in ISO format. Allow ±1 day for time-zone
  // jitter at boundaries.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const datePostedDays = extractPostingAgeDays(`"datePosted": "${thirtyDaysAgo}"`);
  if (datePostedDays === 30 || datePostedDays === 29 || datePostedDays === 31) {
    pass('Parses JSON-LD datePosted field');
  } else {
    fail(`Should parse JSON-LD datePosted; got ${datePostedDays}`);
  }

  if (extractPostingAgeDays('No date here at all') === null) {
    pass('Returns null when no date pattern present');
  } else {
    fail('Should return null when no date pattern present');
  }

  if (extractPostingAgeDays('') === null) {
    pass('Returns null on empty body');
  } else {
    fail('Should return null on empty body');
  }

  // ---- formatLivenessCell ----

  if (formatLivenessCell(null) === '—') {
    pass('Empty entry formats as em-dash (preserves column count)');
  } else {
    fail('Empty entry should format as em-dash');
  }

  if (formatLivenessCell({ result: 'live', ageDays: 5 }) === '🟢 Live') {
    pass('Live + recent posting formats as plain Live');
  } else {
    fail('Live + recent posting should format as plain Live');
  }

  if (formatLivenessCell({ result: 'live', ageDays: 60 }).includes('60d')) {
    pass('Live + old posting (>=45 days) shows age warning');
  } else {
    fail('Live + old posting should show age warning');
  }

  if (formatLivenessCell({ result: 'stale', ageDays: 60 }) === '💀 Stale') {
    pass('Stale entry never shows age warning (already stale)');
  } else {
    fail('Stale entry should not show age warning');
  }

  if (formatLivenessCell({ result: 'unknown', ageDays: null }) === '❓ Unknown') {
    pass('Unknown entry formats correctly');
  } else {
    fail('Unknown entry should format as Unknown');
  }

  // ---- formatLivenessCell verified-as-of date ----
  // Date is appended only when checkedAt is present (production entries always
  // carry it); the bare-label tests above pass entries without it.
  const dated = formatLivenessCell({ result: 'live', ageDays: 5, checkedAt: Date.parse('2026-05-25T10:00:00Z') });
  if (dated === '🟢 Live (2026-05-25)') {
    pass('Live entry stamps verified-as-of date when checkedAt present');
  } else {
    fail(`Live entry should stamp date; got "${dated}"`);
  }

  if (formatLivenessCell({ result: 'unknown', checkedAt: Date.parse('2026-05-25T10:00:00Z') }) === '❓ Unknown (2026-05-25)') {
    pass('Unknown entry stamps verified-as-of date when checkedAt present');
  } else {
    fail('Unknown entry should stamp verified-as-of date');
  }

  // ---- isAggregatorUrl ----
  if (isAggregatorUrl('https://www.ziprecruiter.com/c/x/Job/y') &&
      isAggregatorUrl('https://sub.talent.com/job/1') &&
      !isAggregatorUrl('https://job-boards.greenhouse.io/acme/jobs/1')) {
    pass('isAggregatorUrl matches aggregator hosts (www + subdomain), not ATS boards');
  } else {
    fail('isAggregatorUrl misclassified a host');
  }

  // ---- classifyHttpLiveness (pure HTTP-result classifier) ----
  // Long, content-rich body so the SPA-shell guard (200-char floor) passes.
  const jobBody = '<html><body><h1>Head of Product</h1><p>' +
    'We are hiring a Head of Product to own strategy and roadmap across the platform. '.repeat(6) +
    '<a href="/apply">Apply now</a></p></body></html>';

  if (classifyHttpLiveness({ url: 'https://boards.greenhouse.io/acme/jobs/1', status: 410 }).result === 'stale') {
    pass('classifyHttpLiveness: 410 on ATS URL → stale');
  } else {
    fail('classifyHttpLiveness: 410 should be stale');
  }

  if (classifyHttpLiveness({ url: 'https://job-boards.greenhouse.io/acme/jobs/1', status: 404 }).result === 'stale') {
    pass('classifyHttpLiveness: 404 → stale');
  } else {
    fail('classifyHttpLiveness: 404 should be stale');
  }

  const liveRes = classifyHttpLiveness({ url: 'https://job-boards.greenhouse.io/acme/jobs/1', status: 200, body: jobBody });
  if (liveRes.result === 'live') {
    pass('classifyHttpLiveness: confirmed company-page 200 with job content → live');
  } else {
    fail(`classifyHttpLiveness: ATS 200 should be live; got ${liveRes.result}`);
  }

  const aggRes = classifyHttpLiveness({ url: 'https://www.ziprecruiter.com/jobs/abc', status: 200, body: jobBody });
  if (aggRes.result === 'unknown') {
    pass('classifyHttpLiveness: aggregator 200 → unknown (never asserts live from HTTP)');
  } else {
    fail(`classifyHttpLiveness: aggregator 200 should be unknown; got ${aggRes.result}`);
  }

  const aggDead = classifyHttpLiveness({ url: 'https://www.bebee.com/job/xyz', status: 200, body: 'This position is no longer available. ' + jobBody });
  if (aggDead.result === 'stale') {
    pass('classifyHttpLiveness: aggregator + dead signal → stale (dead checks still authoritative)');
  } else {
    fail(`classifyHttpLiveness: aggregator + dead signal should be stale; got ${aggDead.result}`);
  }

  const spaRes = classifyHttpLiveness({ url: 'https://acme.com/jobs/1', status: 200, body: '<html><body><div id="root"></div><script>app()</script></body></html>' });
  if (spaRes.result === 'unknown') {
    pass('classifyHttpLiveness: SPA shell (no visible text) → unknown');
  } else {
    fail(`classifyHttpLiveness: SPA shell should be unknown; got ${spaRes.result}`);
  }

  // CodeQL hardening: a closing </script > with trailing whitespace (or
  // attrs) must still be recognized as part of the script block, otherwise
  // the script CONTENTS leak into the visible-text length heuristic and a
  // SPA shell falsely scores "live". The script body here is >200 chars on
  // its own; only ~3 chars of real content ("Hi.") sit outside.
  const trailingSpaceClose =
    '<html><body><script>' + 'console.log(1); '.repeat(20) + '</script >Hi.</body></html>';
  const ts = classifyHttpLiveness({ url: 'https://acme.com/jobs/2', status: 200, body: trailingSpaceClose });
  if (ts.result === 'unknown') {
    pass('classifyHttpLiveness: </script > (trailing whitespace) is stripped — script content does NOT inflate visible-text');
  } else {
    fail(`classifyHttpLiveness: trailing-whitespace </script > should yield unknown; got ${ts.result}`);
  }
} catch (e) {
  fail(`Liveness HTTP tests crashed: ${e.message}`);
}

// ── 5b. SCORING MODEL V2 — gates, level-gate, weighted score ─────
//
// Five synthetic roles — one per gate archetype (onsite, international, suspect
// attribution, hybrid-metro martech, stale) — plus the unit tests from the spec.
// Gates run BEFORE scoring; a hard skip drops/quarantines and can never be
// out-competed by a strong title.

console.log('\n5b. Scoring Model V2 (gates + weighted score)');

try {
  const sp = await import(pathToFileURL(join(ROOT, 'score-and-publish.mjs')).href);
  const { classifyLevel, evaluateRole, buildIndexes, computeScore, locationFromUrl,
    sourceTier, resolveLocation, reconcileLevel, isSuspectAttribution, livenessFloor } = sp;
  const { _internals: liveInt } = await import(pathToFileURL(join(ROOT, 'liveness-http.mjs')).href);
  const { _internals: jdInt } = await import(pathToFileURL(join(ROOT, 'fetch-jd.mjs')).href);

  // Location gates (G3/G4/G5) only run when geographic.remote_only is on. The live
  // profile sets it; CI has no profile.yml (remote_only defaults off), so inject the
  // policy here to keep these fixtures deterministic regardless of ambient config.
  // metros is intentionally empty: these fixtures use non-metro locations, so metro
  // matching isn't exercised — and it keeps real commute geography out of a public file.
  const REMOTE_ONLY_GEO = { remoteOnly: true, metros: [] };

  // ---- Acceptance: one fixture per gate archetype ----
  // Fictional companies on generic public job-board domains; each exercises a
  // distinct gate. Rename freely — the coverage (drop/quarantine/survive per
  // gate) is what the assertions below lock in.
  const five = [
    { key: 'Harborview', want: 'drop', gate: 'G3', job: { title: 'Director, Product AI and Platforms', company: 'Harborview Legal LLP', url: 'https://www.jobleads.com/us/job/director-product-ai-platforms--washington--a1b2c3d4e5f6', location: '' } },
    { key: 'Northwind', want: 'drop', gate: 'G4', job: { title: 'Staff Product Manager, Cloud Platform', company: 'Northwind Robotics', url: 'https://job-boards.greenhouse.io/northwindrobotics/jobs?gh_jid=1088342765', location: 'London, United Kingdom' } },
    { key: 'Ridgeline', want: 'quarantine', gate: 'G11', job: { title: 'Senior Marketing Operations Lead', company: 'Ridgeline Manufacturing Co', url: 'https://www.jobleads.com/us/job/sr-manager-marketing-operations--cleveland--f4a9c2075b18', location: 'Cleveland, Ohio', jd: 'Own our HubSpot, Marketo, and Pardot martech stack.' } },
    { key: 'Beacon Labs', want: 'drop', gate: 'G3', job: { title: 'Senior Manager, Lifecycle Marketing Operations', company: 'Beacon Labs', url: 'https://job-boards.greenhouse.io/beaconlabs/jobs/5107', location: 'Mountain View, CA', jd: 'Hybrid — 4 days a week in our SF or Mountain View office. Marketo administration.' } },
    { key: 'Vantage', want: 'survive', gate: 'G10', job: { title: 'Senior Manager, Product Management – Data Integrations', company: 'Vantage Metrics', url: 'https://job-boards.greenhouse.io/vantagemetrics/jobs/612', location: 'Remote (US)', jd: 'Remote-eligible. Own the data integrations roadmap.' } },
  ];
  const idx = buildIndexes(five.map(f => f.job));
  for (const { key, want, gate, job } of five) {
    const ev = evaluateRole(job, idx, undefined, REMOTE_ONLY_GEO);
    const v = ev.gate.verdict;
    const ok = want === 'survive' ? (v === 'pass' || v === 'cap_review') : v === want;
    if (ok) pass(`${key}: ${want === 'survive' ? 'survives gates' : `${want} (${gate})`} — verdict=${v}`);
    else fail(`${key}: expected ${want}, got verdict=${v} (reasons: ${ev.gate.reasons.join('; ')})`);
  }

  // G10: a remote-eligible role survives the gates AND liveness marks it stale (expired/410).
  const cev = evaluateRole(five[4].job, idx, undefined, REMOTE_ONLY_GEO);
  const staleByHttp = liveInt.classifyHttpLiveness({ url: five[4].job.url, status: 410 }).result === 'stale';
  if ((cev.gate.verdict === 'pass' || cev.gate.verdict === 'cap_review') && staleByHttp) {
    pass('Remote role survives gates and is marked STALE by liveness (G10)');
  } else {
    fail(`G10 stale-survivor path broke: verdict=${cev.gate.verdict}, staleByHttp=${staleByHttp}`);
  }

  // ---- Unit tests ----
  // #1 — marketing-ops classified as martech, NOT a PM Sr Manager (the marketing-ops
  //      impersonation bug: "Senior Manager, ... Marketing Operations" must not read
  //      as a primary-target PM Senior Manager).
  const u1 = classifyLevel('Senior Manager, Lifecycle Marketing Operations');
  if (u1.track === 'martech' && /MktOps/.test(u1.level)) pass('#1 classifyLevel(marketing-ops title) = marketing-ops, not PM Sr Manager');
  else fail(`#1 marketing-ops title misclassified: ${JSON.stringify(u1)}`);

  // #2 — demotion title drops
  if (classifyLevel('Senior Product Manager, Growth').gate === 'drop') pass('#2 classifyLevel(Senior Product Manager, Growth) → gate:drop');
  else fail('#2 Senior Product Manager, Growth should gate:drop');

  // #3 — Staff/Principal/Director all pass, and level creates NO score differential
  const passLevels = ['Staff Product Manager, AI', 'Principal PM', 'Director of Product'];
  if (passLevels.every(t => classifyLevel(t).gate === 'pass')) pass('#3 Staff / Principal / Director all gate:pass');
  else fail('#3 Staff/Principal/Director should all pass');
  const mk = (t) => ({ title: t, company: 'Acme', url: 'https://job-boards.greenhouse.io/acme/jobs/1', location: 'Remote (US)', jd: 'AI product roadmap and platform strategy' });
  const eqScores = ['Staff Product Manager, Data Platform', 'Principal Product Manager, Data Platform', 'Director, Product Management, Data Platform']
    .map(t => computeScore(mk(t), { loc: { cls: 'Remote', metro: false }, level: classifyLevel(t) }).score_s1);
  if (eqScores.every(s => s === eqScores[0])) pass(`#3 level does not rank — identical score ${eqScores[0]} across Staff/Principal/Director`);
  else fail(`#3 level leaked into the score: ${eqScores.join(', ')}`);
  const dimsKeys = Object.keys(computeScore(mk('Staff PM'), { loc: { cls: 'Remote', metro: false } }).dims);
  if (!dimsKeys.includes('level')) pass('#3 computeScore has no level dimension');
  else fail('#3 computeScore must not have a level dimension');

  // #4 — URL-slug city parsing
  if (locationFromUrl('https://www.jobleads.com/us/job/x--washington--a1b2c3d4e5f6').includes('washington')) pass('#4 locationFromUrl(--washington--) → washington');
  else fail('#4 locationFromUrl should extract washington from a --city-- slug');

  // #5 — liveness: job ID in the QUERY string (not just the path)
  if (liveInt.isGenericCareersRedirect('https://x.co/jobs?gh_jid=123', 'https://x.co/jobs') === true) pass('#5 isGenericCareersRedirect(?gh_jid=123 → /jobs) → true');
  else fail('#5 query-string job-ID redirect should be detected');

  // #6 — no company-tier floor to 4.0
  const weakAtTier1 = computeScore({ title: 'Product Manager', company: 'Anthropic', url: 'https://x', location: 'Remote (US)' }, { loc: { cls: 'Remote', metro: false }, level: classifyLevel('Product Manager') });
  if (weakAtTier1.score_s1 < 4.0) pass(`#6 company tier cannot floor a score to 4.0 (tier-1 plain PM = ${weakAtTier1.score_s1})`);
  else fail(`#6 company tier floored a weak role to ${weakAtTier1.score_s1}`);

  // #7 — a role failing a gate never appears in Top Matches / Worth Reviewing
  const cohort = [
    { title: 'Senior Product Manager, Growth', company: 'BigCo', url: 'https://job-boards.greenhouse.io/bigco/jobs/1', location: 'Remote (US)' },                                // demotion → drop
    { title: 'Principal Product Manager, AI Platform', company: 'Anthropic', url: 'https://job-boards.greenhouse.io/anthropic/jobs/2', location: 'Remote (US)', jd: 'AI product strategy roadmap platform evals agentic' }, // strong → APPLY
  ];
  const cidx = buildIndexes(cohort);
  const evs = cohort.map(j => ({ title: j.title, ev: evaluateRole(j, cidx, undefined, REMOTE_ONLY_GEO) }));
  const active = evs.filter(e => e.ev.gate.verdict === 'pass' || e.ev.gate.verdict === 'cap_review');
  const topOrReview = active.filter(e => e.ev.recommendation === '🟢 APPLY' || e.ev.recommendation === '🟡 REVIEW').map(e => e.title);
  if (!topOrReview.some(t => /Senior Product Manager, Growth/.test(t)) && topOrReview.some(t => /Principal Product Manager, AI Platform/.test(t))) {
    pass('#7 gated demotion role absent from Top Matches/Worth Reviewing; strong role present');
  } else {
    fail(`#7 gate-visibility invariant broke — topOrReview=${JSON.stringify(topOrReview)}`);
  }

  // G11 JD-hash: identical (substantive) JD body under two employers → both quarantined.
  // Must be >= 300 chars: only substantive JDs are hashed, so a short boilerplate
  // shell can't collide across unrelated roles and spuriously trip G11.
  const jd = 'We are seeking a Marketing Operations Manager to own our HubSpot, Marketo, and Salesforce lifecycle campaigns and attribution reporting for enterprise B2B demand generation. You will build and maintain nurture programs, manage lead scoring and routing, own the martech integration roadmap, and partner with sales operations on funnel analytics, dashboards, and pipeline reporting across the full customer lifecycle.';
  const dupA = { title: 'Marketing Operations Manager', company: 'Alpha Corp', url: 'https://a.com/jobs/1', location: 'Remote (US)', jd };
  const dupB = { title: 'Marketing Operations Manager', company: 'Beta LLC', url: 'https://b.com/jobs/1', location: 'Remote (US)', jd };
  const didx = buildIndexes([dupA, dupB]);
  if (evaluateRole(dupA, didx).gate.verdict === 'quarantine' && evaluateRole(dupB, didx).gate.verdict === 'quarantine') {
    pass('G11 JD-hash: identical JD under 2 employers → both quarantined');
  } else {
    fail('G11 JD-hash: duplicate JD across employers should quarantine both');
  }

  // ══ Evidence Layer fix (V2.1) — RCA II acceptance set ═══════════════════════
  // Fixtures are FICTIONAL companies on generic public domains (leak-check safe);
  // each exercises the RCA II root cause named in the comment. GEO injects the
  // remote-only policy + comp floor so gates fire deterministically in CI.
  const GEO_FLOOR = { remoteOnly: true, metros: [], compFloor: 200000 };
  const emptyIdx = { jdHashToCompanies: new Map(), t1Keys: new Set() };

  // RC-3 / Task 3 — sourceTier FAILS CLOSED (default T3).
  if (sourceTier('https://www.tealhq.com/job/x').tier === 3) pass('EL#1 sourceTier(teal aggregator) → T3 (was T1)');
  else fail(`EL#1 sourceTier(teal) should be T3, got ${sourceTier('https://www.tealhq.com/job/x').tier}`);
  if (sourceTier('https://boards.greenhouse.io/x/jobs/1').tier === 1) pass('EL#2 sourceTier(greenhouse ATS) → T1');
  else fail('EL#2 sourceTier(greenhouse) should be T1');
  if (sourceTier('https://some-domain-nobody-listed.com/job/1').tier === 3) pass('EL#3 sourceTier(unknown domain) → T3 (default untrusted)');
  else fail('EL#3 unknown domain must default to T3, not T1');

  // RC-4 / Task 4 — location weighted by source confidence.
  const aggLoc = resolveLocation({ location: 'Remote', url: 'https://www.jobleads.com/us/job/x' });
  if (aggLoc.confidence === 'low' && aggLoc.resolved === false) pass('EL#4 resolveLocation(aggregator-only "Remote") → low confidence → UNRESOLVED');
  else fail(`EL#4 aggregator-only location should be low/unresolved, got ${JSON.stringify(aggLoc)}`);
  const atsLoc = resolveLocation({ atsLocation: 'San Francisco, CA', url: 'https://job-boards.greenhouse.io/x/jobs/1' });
  if (atsLoc.confidence === 'high' && atsLoc.resolved === true) pass('EL#5 resolveLocation(Greenhouse location.name) → high confidence → resolved');
  else fail(`EL#5 ATS location should be high/resolved, got ${JSON.stringify(atsLoc)}`);
  // Bad-data-beats-no-data case: an aggregator digest says "Remote" (low) but the
  // JD says a specific metro + Hybrid (medium) → the JD wins → drop G3.
  const fresh = { title: 'Director, Product', company: 'Everbright Software', url: 'https://www.tealhq.com/job/director-product', location: 'Remote', jd: 'This role is hybrid — 3 days a week in our San Mateo, CA office.' };
  if (evaluateRole(fresh, buildIndexes([fresh]), undefined, GEO_FLOOR).gate.verdict === 'drop') pass('EL#5b digest "Remote" overridden by JD "metro Hybrid" → drop (G3), not published as Remote');
  else fail('EL#5b JD-body hybrid location should override the aggregator "Remote" and drop on G3');

  // RC-2 / Task 2 — soft-404 + liveness fails closed.
  const soft404Body = 'Browse 250 remote product and marketing jobs. Filter by category, salary, and company. '.repeat(15);
  if (liveInt.classifyHttpLiveness({ url: 'https://weworkremotely.com/remote-jobs/x-integrations-lead', status: 200, body: soft404Body, expectedTitle: 'Application Platform Integrations Lead' }).result === 'stale') {
    pass('EL#6 soft-404: HTTP 200 but body missing the role title → stale');
  } else {
    fail('EL#6 soft-404 should mark a 200 whose body dropped the role title as stale');
  }
  // Invariant: an unknown-liveness role can NEVER hold an effective score >= 4.0.
  if (livenessFloor(4.6, 'unknown') < 4.0 && livenessFloor(4.6, 'stale') < 4.0 && livenessFloor(4.6, 'live') === 4.6) {
    pass('EL#7 liveness fails closed: unknown/stale capped < 4.0; only "live" keeps APPLY');
  } else {
    fail(`EL#7 liveness floor broken: unknown=${livenessFloor(4.6, 'unknown')}, live=${livenessFloor(4.6, 'live')}`);
  }
  if (liveInt.AGGREGATOR_DOMAINS.has('weworkremotely.com')) pass('EL#7b WWR added to AGGREGATOR_DOMAINS (a 200 cannot assert live)');
  else fail('EL#7b weworkremotely.com must be an aggregator domain');

  // RC-5 / Task 5 — generalized G11 legitimacy.
  const tryApply = { title: 'Head of Marketing Operations Remote', company: 'TryApplyNow', url: 'https://jooble.org/jdp/123', location: 'Remote (US)' };
  if (evaluateRole(tryApply, buildIndexes([tryApply]), undefined, GEO_FLOOR).gate.verdict === 'quarantine') {
    pass('EL#8 "TryApplyNow" apply-service shell on T3 → suspect attribution → quarantine');
  } else {
    fail('EL#8 aggregator-shell employer should quarantine as suspect attribution');
  }
  // Guard against over-flagging: a plausibly-real unknown company on T3 is NOT suspect.
  if (isSuspectAttribution('Everbright Software', 'Director, Product', 3) === false) pass('EL#8b plausible unknown company on T3 is NOT over-flagged as suspect');
  else fail('EL#8b a plausibly-real employer must not be flagged suspect merely for being T3');

  // RC-6 / Task 6 — reconcile scraped title against the JD's own title.
  const recon = reconcileLevel('Head of Marketing Operations Remote', 'Marketing Operations Manager');
  if (recon.inflated === true && /MktOps$/.test(recon.level.level)) {
    pass('EL#9 title reconciliation: scraped "Head of…" + JD "…Manager" → re-classified from JD (inflated flagged)');
  } else {
    fail(`EL#9 title reconciliation broke: ${JSON.stringify(recon)}`);
  }

  // G12 canonical resolution: a T3-aggregator mirror whose fetched JD points at a
  // Greenhouse T1 canonical resolves to first-party → G12 no longer caps it. The
  // SAME role WITHOUT the canonical stays G12-capped — a true before/after.
  const mirrorBase = { title: 'Principal Product Manager, API and Platform', company: 'Rivertown Audio', url: 'https://www.jobleads.com/us/job/principal-pm-api-platform--remote--9f8e7d6c5b4a', location: 'Remote (US)', jd: 'Own the API platform roadmap. AI product strategy, developer platform, evals.' };
  const noCanon = evaluateRole({ ...mirrorBase }, buildIndexes([{ ...mirrorBase }]), undefined, GEO_FLOOR).gate.reasons.join(';');
  const withCanon = { ...mirrorBase, canonicalUrl: 'https://boards.greenhouse.io/rivertown/jobs/4455' };
  const withReasons = evaluateRole(withCanon, buildIndexes([withCanon]), undefined, GEO_FLOOR).gate.reasons.join(';');
  if (/G12/.test(noCanon) && !/G12/.test(withReasons)) {
    pass('EL#10 T3 mirror capped by G12; with a Greenhouse canonical in its JD → G12 resolved (T3→T1)');
  } else {
    fail(`EL#10 G12 canonical resolution broke: noCanon="${noCanon}" withCanon="${withReasons}"`);
  }

  // PROMOTION (the fix must PROMOTE, not only drop): a Lever ATS role with an
  // authoritative "Remote — North America" location LEAVES quarantine → REVIEW/APPLY.
  const promo = { title: 'Principal Product Manager, Agentic Surfaces', company: 'Auroria Audio', url: 'https://jobs.lever.co/auroria/abc123', atsLocation: 'Remote — North America', jsonldLocationType: 'TELECOMMUTE', jd: 'Own the agentic surfaces roadmap. AI product strategy, platform, evals, LLM.' };
  const promoEv = evaluateRole(promo, buildIndexes([promo]), undefined, GEO_FLOOR);
  if ((promoEv.gate.verdict === 'pass' || promoEv.gate.verdict === 'cap_review') && promoEv.loc.resolved && promoEv.loc.cls === 'Remote') {
    pass(`EL#11 PROMOTION: Lever ATS "Remote — North America" resolves G5 → leaves quarantine (verdict=${promoEv.gate.verdict}, ~${promoEv.effective})`);
  } else {
    fail(`EL#11 promotion path broke: verdict=${promoEv.gate.verdict}, loc=${JSON.stringify(promoEv.loc)}`);
  }

  // fetch-jd ATS fast-path URL construction (pure — no network).
  if (jdInt.greenhouseApi('https://job-boards.greenhouse.io/acme/jobs/123') === 'https://boards-api.greenhouse.io/v1/boards/acme/jobs/123') pass('EL#12 fetch-jd maps a Greenhouse job URL → boards-api endpoint');
  else fail('EL#12 greenhouseApi URL construction broke');
  if (/api\.lever\.co\/v0\/postings\/acme\//.test(jdInt.leverApi('https://jobs.lever.co/acme/0a1b2c3d4e5f6071') || '')) pass('EL#13 fetch-jd maps a Lever job URL → Lever postings API');
  else fail('EL#13 leverApi URL construction broke');

} catch (e) {
  fail(`Scoring Model V2 tests crashed: ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`);
}

// ── 4. DASHBOARD BUILD ──────────────────────────────────────────

if (!QUICK) {
  console.log('\n6. Dashboard build');
  const goBuild = run('cd dashboard && go build -o /tmp/career-dashboard-test . 2>&1');
  if (goBuild !== null) {
    pass('Dashboard compiles');
  } else {
    fail('Dashboard build failed');
  }
} else {
  console.log('\n6. Dashboard build (skipped --quick)');
}

// ── 5. DATA CONTRACT ────────────────────────────────────────────

console.log('\n7. Data contract validation');

// Check system files exist
const systemFiles = [
  'CLAUDE.md', 'VERSION', 'DATA_CONTRACT.md',
  'modes/_shared.md', 'modes/_profile.template.md',
  'modes/oferta.md', 'modes/pdf.md', 'modes/scan.md',
  'templates/states.yml', 'templates/cv-template.html',
  '.claude/skills/career-ops/SKILL.md',
];

for (const f of systemFiles) {
  if (fileExists(f)) {
    pass(`System file exists: ${f}`);
  } else {
    fail(`Missing system file: ${f}`);
  }
}

// Check user files are NOT tracked (gitignored)
const userFiles = [
  'config/profile.yml', 'modes/_profile.md', 'portals.yml',
];
for (const f of userFiles) {
  const tracked = run('git', ['ls-files', f]);
  if (tracked === '') {
    pass(`User file gitignored: ${f}`);
  } else if (tracked === null) {
    pass(`User file gitignored: ${f}`);
  } else {
    fail(`User file IS tracked (should be gitignored): ${f}`);
  }
}

// ── 6. PERSONAL DATA LEAK CHECK ─────────────────────────────────

console.log('\n8. Personal data leak check');

// WARN-level: original-author (santifer) credit. Attribution legitimately appears
// in some non-allowlisted files (TRADEMARK, CHANGELOG, translated READMEs), so we
// surface stray references for review but do NOT block on them.
const leakPatterns = [
  'Santiago', 'santifer.io', 'Santifer iRepair', 'Zinkee', 'ALMAS',
  'hi@santifer.io', '688921377', '/Users/santifer/',
];

// HARD-FAIL: fork-maintainer PII + personal-search data. This fork drives a real
// job search, so these must NEVER land in tracked system files — real values live
// only in gitignored config/profile.yml. Author credit in the plugin manifests is
// allowlisted below (already public on origin/main); everything else fails the build.
// The maintainer's private phone is assembled from fragments ON PURPOSE so this
// PUBLIC file never contains the literal PII it guards against. Do NOT collapse it
// back into a literal string — that would re-publish the very data this check
// exists to keep out of the repo.
const maintainerPhone = ['206', '755', '7509'].join('.');
const hardLeakPatterns = [
  // Name + handle are already public as maintainer attribution (README / plugin
  // manifests / FORK_NOTES); listed here so they can't spread into other system
  // files. 'joegarvey7' also matches the gmail / github / linkedin forms, so the
  // literal email is intentionally NOT spelled out.
  'Joe Garvey', 'Garvey', "Joe's", 'joegarvey7',
  maintainerPhone,                       // dotted form (e.g. pasted from a CV)
  maintainerPhone.replace(/\./g, ''),    // digits-only form
  // Any hardcoded NON-ZERO comp floor in tracked code (the sanitized default is
  // comp_floor: 0). Generic regex — catches a regression without naming a figure.
  'comp_floor: [1-9]',
  // Real companies whose live roles seeded development. Never reintroduce as test
  // fixtures — §5b uses fictional companies. Glean and Wayve are deliberately NOT
  // listed: both are legitimate public companies (Wayve appears in
  // templates/portals.example.yml; Glean is a common public target), so a bare
  // pattern would risk false-positives.
  'Goodwin', 'Dormont', 'Comscore',
];

const scanExtensions = ['md', 'yml', 'html', 'mjs', 'sh', 'go', 'json'];
const allowedFiles = [
  // English README + localized translations (all legitimately credit Santiago)
  'README.md', 'README.es.md', 'README.ja.md', 'README.ko-KR.md',
  'README.pt-BR.md', 'README.ru.md',
  // Standard project files
  'LICENSE', 'CITATION.cff', 'CONTRIBUTING.md',
  'package.json', '.github/FUNDING.yml', 'CLAUDE.md', 'AGENTS.md', 'go.mod', 'test-all.mjs',
  // Community / governance files (added in v1.3.0, all legitimately reference the maintainer)
  'CODE_OF_CONDUCT.md', 'GOVERNANCE.md', 'SECURITY.md', 'SUPPORT.md',
  '.github/SECURITY.md',
  // Dashboard credit string
  'dashboard/internal/ui/screens/pipeline.go',
  // Fork plugin manifests legitimately credit the fork maintainer as author
  // (analogous to the README credits above; already public on origin/main).
  '.claude-plugin/marketplace.json', '.claude-plugin/plugin.json',
  // FORK_NOTES.md documents the fork; its title carries the fork handle
  // (joegarvey7/career-ops) as legitimate attribution.
  'FORK_NOTES.md',
];

// Build pathspec for git grep — only scan tracked files matching these
// extensions. This is what `grep -rn` was trying to do, but git-aware:
// untracked files (debate artifacts, AI tool scratch, local plans/) and
// gitignored files can't trigger false positives because they were never
// going to reach a commit anyway.
const grepPathspec = scanExtensions.map(e => `'*.${e}'`).join(' ');

const scanForPatterns = (patterns) => {
  const hits = [];
  for (const pattern of patterns) {
    const result = run(`git grep -n "${pattern}" -- ${grepPathspec} 2>/dev/null`);
    if (!result) continue;
    for (const line of result.split('\n')) {
      const file = line.split(':')[0];
      if (!file) continue;
      if (allowedFiles.some(a => file.includes(a))) continue;
      if (file.includes('dashboard/go.mod')) continue;
      hits.push({ file, pattern });
    }
  }
  return hits;
};

// HARD-FAIL: maintainer PII / personal-search data must never reach a tracked file.
const hardHits = scanForPatterns(hardLeakPatterns);
for (const { file, pattern } of hardHits) fail(`Personal data leak in ${file}: "${pattern}"`);
if (hardHits.length === 0) {
  pass('No maintainer PII / personal-search data in tracked files');
}

// WARN-level: stray original-author credit (informational, non-blocking).
const softHits = scanForPatterns(leakPatterns);
for (const { file, pattern } of softHits) warn(`Author-credit reference in ${file}: "${pattern}"`);
let leakFound = softHits.length > 0;
if (!leakFound) {
  pass('No stray author-credit references outside allowed files');
}

// ── 7. ABSOLUTE PATH CHECK ──────────────────────────────────────

console.log('\n9. Absolute path check');

// Same git grep approach: only scans tracked files. Untracked AI tool
// outputs, local debate artifacts, etc. can't false-positive here.
const absPathResult = run(
  `git grep -n "/Users/" -- '*.mjs' '*.sh' '*.md' '*.go' '*.yml' 2>/dev/null | grep -v README.md | grep -v LICENSE | grep -v CLAUDE.md | grep -v test-all.mjs`
);
if (!absPathResult) {
  pass('No absolute paths in code files');
} else {
  for (const line of absPathResult.split('\n').filter(Boolean)) {
    fail(`Absolute path: ${line.slice(0, 100)}`);
  }
}

// ── 8. MODE FILE INTEGRITY ──────────────────────────────────────

console.log('\n10. Mode file integrity');

const expectedModes = [
  '_shared.md', '_profile.template.md', 'oferta.md', 'pdf.md', 'scan.md',
  'batch.md', 'apply.md', 'auto-pipeline.md', 'contacto.md', 'deep.md',
  'ofertas.md', 'pipeline.md', 'project.md', 'tracker.md', 'training.md',
];

for (const mode of expectedModes) {
  if (fileExists(`modes/${mode}`)) {
    pass(`Mode exists: ${mode}`);
  } else {
    fail(`Missing mode: ${mode}`);
  }
}

// Check _shared.md references _profile.md
const shared = readFile('modes/_shared.md');
if (shared.includes('_profile.md')) {
  pass('_shared.md references _profile.md');
} else {
  fail('_shared.md does NOT reference _profile.md');
}

// ── 9. LOCAL PARSER CONTRACT ────────────────────────────────────

console.log('\n9. Local parser contract');

const scanScript = readFile('scan.mjs');
if (
  scanScript.includes('typeof company.name !== \'string\'') &&
  scanScript.includes('company.name.trim()') &&
  scanScript.includes('company.name.toLowerCase()')
) {
  pass('scan.mjs guards company names before filtering');
} else {
  fail('scan.mjs does not guard company names before filtering');
}

if (
  scanScript.includes("skipIds: ['local-parser']") &&
  scanScript.includes('local parser failed, used API fallback') &&
  scanScript.includes('resolveProvider(company, providers')
) {
  pass('scan.mjs falls back to ATS API when local parser fails');
} else {
  fail('scan.mjs does not fall back to ATS API when local parser fails');
}

if (fileExists('providers/local-parser.mjs')) {
  pass('local-parser provider module exists');
} else {
  fail('local-parser provider module is missing');
}

const scanMode = fileExists('modes/scan.md') ? readFile('modes/scan.md') : '';
if (
  scanMode.includes('local_parser_ok') &&
  scanMode.includes('no repetir scraping caro') &&
  scanMode.includes('nombre no listado en `local_parser_ok`')
) {
  pass('scan.md skips expensive levels after successful local parser');
} else {
  fail('scan.md missing local_parser_ok skip rules for agent scan');
}

if (!fileExists('scripts/parsers/cohere_jobs.py')) {
  pass('Cohere parser example is not bundled as a runtime script');
} else {
  fail('Cohere parser example is still bundled as a runtime script');
}

const portalExample = readFile('templates/portals.example.yml');
if (
  !portalExample.includes('cohere_jobs.py') &&
  portalExample.includes('scripts/parsers/example-js-company-jobs.js') &&
  portalExample.includes('scripts/parsers/example_python_company_jobs.py') &&
  portalExample.includes('already know their target careers URL')
) {
  pass('portals example documents a generic local parser contract');
} else {
  fail('portals example still points at a bundled Cohere parser');
}

// ── 10. AGENTS.md INTEGRITY ─────────────────────────────────────

console.log('\n10. AGENTS.md integrity');

const agents = readFile('AGENTS.md');
const requiredSections = [
  'Data Contract', 'Update Check', 'Ethical Use',
  'Offer Verification', 'Canonical States', 'TSV Format',
  'First Run', 'Onboarding',
];

for (const section of requiredSections) {
  if (agents.includes(section)) {
    pass(`AGENTS.md has section: ${section}`);
  } else {
    fail(`AGENTS.md missing section: ${section}`);
  }
}

// ── 11. VERSION FILE ─────────────────────────────────────────────

console.log('\n11. Version file');

if (fileExists('VERSION')) {
  const version = readFile('VERSION').trim();
  if (/^\d+\.\d+\.\d+$/.test(version)) {
    pass(`VERSION is valid semver: ${version}`);
  } else {
    fail(`VERSION is not valid semver: "${version}"`);
  }
} else {
  fail('VERSION file missing');
}

// ── 11. LOCATION FILTER — always_allow tier ───────────────────────

console.log('\n11. Location filter — always_allow tier');

try {
  const { buildLocationFilter } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

  const filter = buildLocationFilter({
    always_allow: ['belgium', 'brussels'],
    allow: ['europe', 'emea', 'remote'],
    block: ['france', 'germany', 'united states'],
  });

  // Case 1: home-region passes regardless of other text
  if (filter('Brussels, Belgium') === true) pass('Brussels, Belgium passes (always_allow hit)');
  else fail('Brussels, Belgium should pass');

  // Case 2: always_allow wins over block (THE motivating case for this tier)
  if (filter('Remote, Belgium or France') === true) pass('Remote, Belgium or France passes (always_allow beats block)');
  else fail('Remote, Belgium or France should pass — always_allow must win over block');

  // Case 3: no always_allow hit, block still rejects
  if (filter('Paris, France') === false) pass('Paris, France is rejected (block still applies)');
  else fail('Paris, France should be rejected');

  // Case 4: empty location → pass (existing semantics, unchanged)
  if (filter('') === true) pass('empty location passes (unchanged semantics)');
  else fail('empty location should pass');

  // Case 5: case-insensitivity
  if (filter('BRUSSELS, BELGIUM') === true) pass('case-insensitive match works');
  else fail('case-insensitive match failed');

  // Case 6: backward compatibility — no always_allow key behaves like stock allow/block
  const stockFilter = buildLocationFilter({
    allow: ['europe', 'remote'],
    block: ['france'],
  });
  if (stockFilter('Remote, Belgium or France') === false) pass('without always_allow, block still wins (backward compatible)');
  else fail('without always_allow, behaviour must match stock allow/block (block wins)');

  // Case 7: null/missing locationFilter → pass-all filter (early-return path)
  const nullFilter = buildLocationFilter(null);
  if (nullFilter('Anywhere on Earth') === true && nullFilter('') === true) {
    pass('null locationFilter returns a pass-all filter (early-return path)');
  } else {
    fail('null locationFilter should return a pass-all filter');
  }

  // Case 8: string-instead-of-array → wrapped to a 1-item list
  const stringFilter = buildLocationFilter({ always_allow: 'belgium', block: ['france'] });
  if (stringFilter('Remote, Belgium or France') === true) {
    pass('always_allow as a bare string is wrapped to a single-item list');
  } else {
    fail('always_allow as a bare string should still work');
  }

  // Case 9: null/non-string items are filtered out (no crash, no false matches)
  const messyFilter = buildLocationFilter({
    always_allow: [null, 'belgium', 42, undefined],
    block: ['france', null, 7],
  });
  if (messyFilter('Brussels, Belgium') === true && messyFilter('Paris, France') === false) {
    pass('non-string entries (null, numbers, undefined) are filtered out without crashing');
  } else {
    fail('mixed-type keyword lists should not crash and should still match string entries');
  }

  // Case 10: all-null/non-string list → empty after normalization (no false rejects)
  const allBadFilter = buildLocationFilter({ block: [null, 42, undefined], allow: ['remote'] });
  if (allBadFilter('Remote') === true) {
    pass('a block list with only non-string entries normalizes to [] (no false rejects)');
  } else {
    fail('non-string-only block list should not cause rejection');
  }

  // Case 11: empty / whitespace-only entries are dropped (would otherwise pass-all via includes(''))
  const emptyKeywordFilter = buildLocationFilter({
    always_allow: ['', '  '],
    allow: ['remote'],
    block: ['france'],
  });
  if (emptyKeywordFilter('Paris, France') === false) {
    pass('empty/whitespace always_allow entries are dropped (no pass-all via includes(""))');
  } else {
    fail('empty always_allow entries should NOT bypass block — would have made the filter pass-all');
  }

  // Case 12: surrounding whitespace is trimmed so the keyword still matches
  const whitespaceFilter = buildLocationFilter({
    always_allow: ['  Belgium  ', '\tBrussels\n'],
    block: ['france'],
  });
  if (whitespaceFilter('Remote, Belgium or France') === true) {
    pass('whitespace-padded keywords still match after trim');
  } else {
    fail('"  Belgium  " should be trimmed and still match "Remote, Belgium or France"');
  }

  // Case 13: whitespace-only location is treated as missing (pass-all-tiers)
  if (filter('   \t  ') === true) pass('whitespace-only location passes (treated as missing)');
  else fail('whitespace-only location should pass');

  // Case 14: non-string location (number/object/null) → pass without throwing
  let crashed = false;
  try {
    const r1 = filter(42);
    const r2 = filter({ city: 'Brussels' });
    const r3 = filter(null);
    const r4 = filter(undefined);
    if (r1 === true && r2 === true && r3 === true && r4 === true) {
      pass('non-string location values (number, object, null, undefined) pass without throwing');
    } else {
      fail(`non-string location results: number=${r1}, object=${r2}, null=${r3}, undefined=${r4}`);
    }
  } catch (e) {
    crashed = true;
    fail(`non-string location crashed: ${e.message}`);
  }

  // Case 15: a malformed location (e.g. legacy object) does NOT bypass block when interpreted naively —
  // the guard returns true (pass) BEFORE block/allow even run, which is correct: scoring/eval happens
  // downstream from the scan filter, so malformed locations should fall through to the manual evaluation
  // step rather than being silently dropped here.
  if (filter(42) === true) pass('non-string locations are passed through to downstream evaluation, not silently dropped');
  else fail('non-string locations should pass through');

} catch (e) {
  fail(`always_allow tests crashed: ${e.message}`);
}

// ── SUMMARY ─────────────────────────────────────────────────────

console.log('\n' + '='.repeat(50));
console.log(`📊 Results: ${passed} passed, ${failed} failed, ${warnings} warnings`);

if (failed > 0) {
  console.log('🔴 TESTS FAILED — do NOT push/merge until fixed\n');
  process.exit(1);
} else if (warnings > 0) {
  console.log('🟡 Tests passed with warnings — review before pushing\n');
  process.exit(0);
} else {
  console.log('🟢 All tests passed — safe to push/merge\n');
  process.exit(0);
}

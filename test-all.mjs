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
  const result = run('node', ['--check', f]);
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
  { name: 'update-system.mjs check', expectExit: 0 },
];

for (const { name, allowFail } of scripts) {
  const result = run('node', name.split(' '), { stdio: ['pipe', 'pipe', 'pipe'] });
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
  const { isGenericCareersRedirect, extractPostingAgeDays } = _internals;

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
} catch (e) {
  fail(`Liveness HTTP tests crashed: ${e.message}`);
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

const leakPatterns = [
  'Santiago', 'santifer.io', 'Santifer iRepair', 'Zinkee', 'ALMAS',
  'hi@santifer.io', '688921377', '/Users/santifer/',
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
];

// Build pathspec for git grep — only scan tracked files matching these
// extensions. This is what `grep -rn` was trying to do, but git-aware:
// untracked files (debate artifacts, AI tool scratch, local plans/) and
// gitignored files can't trigger false positives because they were never
// going to reach a commit anyway.
const grepPathspec = scanExtensions.map(e => `'*.${e}'`).join(' ');

let leakFound = false;
for (const pattern of leakPatterns) {
  const result = run(
    `git grep -n "${pattern}" -- ${grepPathspec} 2>/dev/null`
  );
  if (result) {
    for (const line of result.split('\n')) {
      const file = line.split(':')[0];
      if (allowedFiles.some(a => file.includes(a))) continue;
      if (file.includes('dashboard/go.mod')) continue;
      warn(`Possible personal data in ${file}: "${pattern}"`);
      leakFound = true;
    }
  }
}
if (!leakFound) {
  pass('No personal data leaks outside allowed files');
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

// ── 9. AGENTS.md INTEGRITY ──────────────────────────────────────

console.log('\n9. AGENTS.md integrity');

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

// ── 10. VERSION FILE ─────────────────────────────────────────────

console.log('\n12. Version file');

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

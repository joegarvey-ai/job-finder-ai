#!/usr/bin/env node
/**
 * evals/run-evals.mjs — regression eval runner for career-ops modes
 *
 * Runs each case in evals/cases/ through gemini-eval.mjs, parses the
 * SCORE_SUMMARY block, and grades it against the case's expected.yml.
 *
 * Usage:
 *   node evals/run-evals.mjs               # all cases
 *   node evals/run-evals.mjs 01            # case 01 only
 *   node evals/run-evals.mjs --save        # save raw outputs to evals/results/
 *   node evals/run-evals.mjs --json        # machine-readable summary
 *
 * Requires GEMINI_API_KEY in .env (or environment). See ../.env.example.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

// Optional dotenv just so we can give a clearer error if GEMINI_API_KEY is missing
try {
  const { config } = await import('dotenv');
  config();
} catch {
  // dotenv not installed — that's fine
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CASES_DIR = join(__dirname, 'cases');
const RESULTS_DIR = join(__dirname, 'results');

const args = process.argv.slice(2);
const SAVE = args.includes('--save');
const JSON_OUT = args.includes('--json');
const caseFilter = args.find(a => !a.startsWith('--'));

// ── Pre-flight ────────────────────────────────────────────────────────────

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY not set. Add it to .env (see .env.example).');
  console.error('Get a free key: https://aistudio.google.com/apikey');
  process.exit(2);
}

if (!existsSync(CASES_DIR)) {
  console.error(`No cases directory: ${CASES_DIR}`);
  process.exit(2);
}

// ── Load cases ────────────────────────────────────────────────────────────

function listCases() {
  return readdirSync(CASES_DIR)
    .filter(name => {
      const p = join(CASES_DIR, name);
      return statSync(p).isDirectory() && !name.startsWith('.');
    })
    .filter(name => !caseFilter || name.startsWith(caseFilter))
    .sort();
}

// Minimal YAML parser sufficient for our expected.yml shape:
//   - top-level scalar keys
//   - nested score: { min, max }
//   - top-level lists
//   - multi-line block scalars with `notes: |`
function parseYaml(text) {
  const out = {};
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
    const m = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1];
    const value = m[2].trim();
    if (value === '|') {
      // Block scalar — read indented lines until dedent
      const block = [];
      i++;
      while (i < lines.length && (lines[i].startsWith('  ') || lines[i] === '')) {
        block.push(lines[i].replace(/^ {2}/, ''));
        i++;
      }
      out[key] = block.join('\n').trim();
      continue;
    }
    if (value === '') {
      // Nested object or list — read indented lines
      const nestedLines = [];
      i++;
      while (i < lines.length && (lines[i].startsWith('  ') || lines[i] === '')) {
        if (lines[i].trim()) nestedLines.push(lines[i].replace(/^ {2}/, ''));
        i++;
      }
      if (nestedLines.length && nestedLines[0].startsWith('-')) {
        out[key] = nestedLines.map(l => l.replace(/^-\s*/, '').replace(/^["']|["']$/g, ''));
      } else {
        out[key] = parseYaml(nestedLines.join('\n'));
      }
      continue;
    }
    // Scalar value
    out[key] = isNaN(Number(value)) ? value.replace(/^["']|["']$/g, '') : Number(value);
    i++;
  }
  return out;
}

function loadCase(name) {
  const dir = join(CASES_DIR, name);
  const inputPath = join(dir, 'input.txt');
  const expectedPath = join(dir, 'expected.yml');
  if (!existsSync(inputPath)) return null;
  const input = readFileSync(inputPath, 'utf8');
  const expected = existsSync(expectedPath) ? parseYaml(readFileSync(expectedPath, 'utf8')) : {};
  return { name, dir, input, expected };
}

// ── Invoke gemini-eval.mjs ────────────────────────────────────────────────

function runEval(jdText) {
  // Write JD to a temp file inside the case dir to avoid CLI-arg shell escaping.
  // Use the case dir itself so the file lives alongside input.txt.
  // gemini-eval.mjs auto-saves reports to reports/ — we accept that side-effect
  // and recommend the user clean reports/ before/after eval runs.
  const result = spawnSync(
    'node',
    [join(ROOT, 'gemini-eval.mjs'), jdText],
    { cwd: ROOT, encoding: 'utf8', timeout: 90_000 }
  );
  if (result.error) {
    return { ok: false, error: result.error.message, stdout: '', stderr: '' };
  }
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function parseSummary(stdout) {
  const m = stdout.match(/---SCORE_SUMMARY---\s*([\s\S]*?)---END_SUMMARY---/);
  if (!m) return null;
  const block = m[1];
  const get = (key) => {
    const r = new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm');
    const found = block.match(r);
    return found ? found[1].trim() : null;
  };
  return {
    company: get('COMPANY'),
    role: get('ROLE'),
    score: parseFloat(get('SCORE')),
    archetype: get('ARCHETYPE'),
    legitimacy: get('LEGITIMACY'),
  };
}

// ── Grade against expected.yml ────────────────────────────────────────────

function grade(stdout, expected) {
  const failures = [];
  const summary = parseSummary(stdout);

  if (expected.score && summary) {
    const { min, max } = expected.score;
    if (!Number.isFinite(summary.score)) {
      failures.push(`score: could not parse from SCORE_SUMMARY`);
    } else if (summary.score < min || summary.score > max) {
      failures.push(`score: ${summary.score} outside expected [${min}, ${max}]`);
    }
  } else if (expected.score && !summary) {
    failures.push(`score: SCORE_SUMMARY block missing from output`);
  }

  if (expected.archetype_any_of && summary) {
    const arch = (summary.archetype || '').toLowerCase();
    const matched = expected.archetype_any_of.some(a => arch.includes(a.toLowerCase()));
    if (!matched) {
      failures.push(`archetype: "${summary.archetype}" did not match any of ${JSON.stringify(expected.archetype_any_of)}`);
    }
  }

  if (expected.legitimacy_any_of && summary) {
    const leg = (summary.legitimacy || '').toLowerCase();
    const matched = expected.legitimacy_any_of.some(l => leg.includes(l.toLowerCase()));
    if (!matched) {
      failures.push(`legitimacy: "${summary.legitimacy}" did not match any of ${JSON.stringify(expected.legitimacy_any_of)}`);
    }
  }

  if (expected.must_contain) {
    for (const needle of expected.must_contain) {
      if (!stdout.toLowerCase().includes(needle.toLowerCase())) {
        failures.push(`must_contain: "${needle}" not found in output`);
      }
    }
  }

  if (expected.must_not_contain) {
    for (const needle of expected.must_not_contain) {
      if (stdout.toLowerCase().includes(needle.toLowerCase())) {
        failures.push(`must_not_contain: "${needle}" was present in output`);
      }
    }
  }

  return { failures, summary };
}

// ── Main ─────────────────────────────────────────────────────────────────

const cases = listCases();
if (cases.length === 0) {
  console.error(`No cases found${caseFilter ? ` matching "${caseFilter}"` : ''} in ${CASES_DIR}`);
  process.exit(2);
}

if (SAVE && !existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

const report = [];
let passed = 0, failed = 0;

if (!JSON_OUT) {
  console.log(`\nRunning ${cases.length} eval case${cases.length === 1 ? '' : 's'}...\n`);
}

for (const name of cases) {
  const tc = loadCase(name);
  if (!tc) {
    console.error(`Skipping ${name}: missing input.txt`);
    continue;
  }

  if (!JSON_OUT) process.stdout.write(`  ${name} ... `);
  const t0 = Date.now();
  const result = runEval(tc.input);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  if (!result.ok) {
    failed++;
    if (!JSON_OUT) {
      console.log(`ERROR (${dt}s)`);
      console.log(`    runner exit ${result.status}: ${result.stderr.slice(0, 200)}`);
    }
    report.push({ name, status: 'error', durationSec: parseFloat(dt), error: result.stderr.slice(0, 500) });
    continue;
  }

  const { failures, summary } = grade(result.stdout, tc.expected);

  if (SAVE) {
    writeFileSync(join(RESULTS_DIR, `${name}.out.txt`), result.stdout);
    if (summary) writeFileSync(join(RESULTS_DIR, `${name}.summary.json`), JSON.stringify(summary, null, 2));
  }

  if (failures.length === 0) {
    passed++;
    if (!JSON_OUT) {
      const s = summary ? ` score=${summary.score} legit=${summary.legitimacy}` : '';
      console.log(`PASS (${dt}s)${s}`);
    }
    report.push({ name, status: 'pass', durationSec: parseFloat(dt), summary });
  } else {
    failed++;
    if (!JSON_OUT) {
      console.log(`FAIL (${dt}s)`);
      for (const f of failures) console.log(`    - ${f}`);
    }
    report.push({ name, status: 'fail', durationSec: parseFloat(dt), failures, summary });
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ passed, failed, cases: report }, null, 2));
} else {
  console.log(`\n${passed} passed, ${failed} failed of ${cases.length} cases.`);
  if (SAVE) console.log(`Raw outputs saved to ${RESULTS_DIR}/`);
}

process.exit(failed > 0 ? 1 : 0);

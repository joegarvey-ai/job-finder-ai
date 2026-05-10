#!/usr/bin/env node
// reconcile-scores.mjs — Feed evaluation scores back into the scanner table
//
// Reads all evaluation reports from reports/, extracts the Global score and URL,
// and writes the adjusted score (Adj.) back into Career_Ops_Scanner.md.
//
// This is equivalent to running: node score-and-publish.mjs --reconcile
// but can also be used standalone to just update Adj. scores without re-scoring.
//
// Usage:
//   node reconcile-scores.mjs            # Update Adj. scores in existing scanner table
//   node reconcile-scores.mjs --dry-run  # Show what would change without writing
//   node reconcile-scores.mjs --json     # Output reconciliation map as JSON

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = import.meta.dirname;
const OBSIDIAN_FILE = join(
  '/Users/josephgarvey/Library/Mobile Documents/iCloud~md~obsidian/Documents',
  '02 Personal Projects/Career Collateral/Career_Ops_Scanner.md'
);

const DRY_RUN = process.argv.includes('--dry-run');
const JSON_OUTPUT = process.argv.includes('--json');

// ── Extract evaluation scores from reports/ ──

function loadEvaluationScores() {
  const scores = new Map(); // URL → { score, reportFile, company, role }
  const reportsDir = join(ROOT, 'reports');
  if (!existsSync(reportsDir)) return scores;

  for (const file of readdirSync(reportsDir).filter(f => f.endsWith('.md'))) {
    const content = readFileSync(join(reportsDir, file), 'utf8');
    const urlMatch = content.match(/^\*\*URL:\*\*\s*(.+)$/m);
    const scoreMatch = content.match(/^\*\*Score:\*\*\s*([\d.]+)\/5/m);
    const titleMatch = content.match(/^# Evaluation:\s*(.+)$/m);
    if (urlMatch && scoreMatch) {
      scores.set(urlMatch[1].trim(), {
        score: parseFloat(scoreMatch[1]),
        reportFile: file,
        title: titleMatch ? titleMatch[1].trim() : file,
      });
    }
  }
  return scores;
}

// ── Tier labels ──

function getTier(score) {
  if (score >= 4.0) return '🟢 APPLY';
  if (score >= 3.0) return '🟡 REVIEW';
  if (score >= 2.0) return '🟠 WEAK';
  return '⚪ SKIP';
}

// ── Main ──

const evalScores = loadEvaluationScores();

if (evalScores.size === 0) {
  console.log('No evaluation reports found in reports/');
  process.exit(0);
}

if (JSON_OUTPUT) {
  const out = {};
  for (const [url, data] of evalScores) {
    out[url] = { adj_score: data.score, report: data.reportFile, title: data.title };
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

// Read scanner table
if (!existsSync(OBSIDIAN_FILE)) {
  console.error(`Scanner table not found: ${OBSIDIAN_FILE}`);
  console.log('Run score-and-publish.mjs first to create the scanner table.');
  process.exit(1);
}

const content = readFileSync(OBSIDIAN_FILE, 'utf8');
const lines = content.split('\n');
let updatedCount = 0;
let matchedCount = 0;
const changes = [];

// Process each line — find table rows with [View](URL) and inject/update Adj. column
const updatedLines = lines.map(line => {
  // Match [View](URL) requiring `)` followed by table cell delimiter `|`,
  // so URLs containing literal parens (ZipRecruiter `(USA)`,
  // `(Business-Cards-&-Payments)`, etc.) aren't truncated at the first inner `)`.
  const urlMatch = line.match(/\[View\]\((.*?)\)\s*\|/);
  if (!urlMatch || !line.startsWith('|')) return line;

  const url = urlMatch[1].trim();
  if (!evalScores.has(url)) return line;

  matchedCount++;
  const evalData = evalScores.get(url);
  const cols = line.split('|').map(c => c.trim()).filter(Boolean);

  // Determine if this row already has an Adj. column (2nd col is empty, score-like, or '—')
  const hasAdj = cols.length >= 8 && (
    cols[1] === '' || cols[1] === '—' || cols[1].match(/^[\d.]+(?:\/5)?$/)
  );

  const currentAdj = hasAdj ? cols[1] : '';
  const newAdj = `${evalData.score}`;

  if (currentAdj === newAdj) return line; // already reconciled

  // Extract surface score for change reporting
  const surfaceScore = parseFloat(cols[0]) || 0;
  const surfaceTier = getTier(surfaceScore);
  const adjTier = getTier(evalData.score);
  const tierChanged = surfaceTier !== adjTier;

  changes.push({
    title: evalData.title,
    report: evalData.reportFile,
    surfaceScore,
    adjScore: evalData.score,
    gap: Math.round((evalData.score - surfaceScore) * 10) / 10,
    surfaceTier,
    adjTier,
    tierChanged,
  });

  if (hasAdj) {
    // Update existing Adj. column
    cols[1] = newAdj;
  } else {
    // Insert Adj. column after Score
    cols.splice(1, 0, newAdj);
  }

  updatedCount++;
  return '| ' + cols.join(' | ') + ' |';
});

// Also update header rows to include Adj. if they don't already
const finalLines = updatedLines.map(line => {
  if (!line.startsWith('|')) return line;
  // Header row detection: contains "Score" and "Company" but no [View]
  if (line.includes('Score') && line.includes('Company') && !line.includes('[View]') && !line.includes('Adj.')) {
    return line.replace('| Score |', '| Score | Adj. |');
  }
  // Separator row detection: all dashes
  if (line.match(/^\|[\s-|]+\|$/) && !line.includes('[View]')) {
    const dashCount = (line.match(/---/g) || []).length;
    // Only add if the header above was updated (we detect by checking adjacent lines)
    // Simpler: just ensure separator has one more column than original if we added Adj.
    // This is tricky line-by-line, so we skip separator updates — score-and-publish.mjs
    // handles this correctly on next full run
  }
  return line;
});

if (DRY_RUN) {
  console.log(`\n━━━ Reconcile Scores (dry run) ━━━`);
  console.log(`Evaluation reports: ${evalScores.size}`);
  console.log(`Matched to scanner: ${matchedCount}`);
  console.log(`Would update:       ${updatedCount}\n`);
  if (changes.length > 0) {
    console.log('Changes:');
    for (const c of changes) {
      const tierNote = c.tierChanged ? ` ⚠️  ${c.surfaceTier} → ${c.adjTier}` : '';
      console.log(`  ${c.title}: ${c.surfaceScore} → Adj. ${c.adjScore} (${c.gap >= 0 ? '+' : ''}${c.gap})${tierNote}`);
    }
  }
} else {
  writeFileSync(OBSIDIAN_FILE, finalLines.join('\n'));
  console.log(`\n━━━ Reconcile Scores ━━━`);
  console.log(`Evaluation reports: ${evalScores.size}`);
  console.log(`Matched to scanner: ${matchedCount}`);
  console.log(`Updated:            ${updatedCount}`);
  if (changes.length > 0) {
    console.log('\nChanges:');
    for (const c of changes) {
      const tierNote = c.tierChanged ? ` ⚠️  ${c.surfaceTier} → ${c.adjTier}` : '';
      console.log(`  ${c.title}: ${c.surfaceScore} → Adj. ${c.adjScore} (${c.gap >= 0 ? '+' : ''}${c.gap})${tierNote}`);
    }
  }
  console.log(`\nPublished to: ${OBSIDIAN_FILE}`);
}

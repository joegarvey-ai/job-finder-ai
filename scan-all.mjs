#!/usr/bin/env node
// scan-all.mjs — Master scan: run ALL sources and write deduplicated results
//
// Usage:
//   node scan-all.mjs              # Run all scrapers
//   node scan-all.mjs --source X   # Run only source X (wellfound, indeed, linkedin, greenhouse-agg, lever-agg, remote-boards)
//   node scan-all.mjs --dry-run    # Filter and dedup but don't write to pipeline/history
//
// Output: data/new_roles_YYYY-MM-DD.md (daily digest) + pipeline.md + scan-history.tsv

import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  loadTitleFilters, loadSeenUrls, matchesTitle, isDuplicate,
  appendToHistory, appendToPipeline, ensureHistoryFile, ensurePipelineFile, log,
} from './scrapers/lib/common.mjs';

const ROOT = import.meta.dirname;
const TODAY = new Date().toISOString().slice(0, 10);

// ── Parse CLI args ──

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const sourceFilter = args.includes('--source') ? args[args.indexOf('--source') + 1] : null;

// ── Import all scrapers ──

const SCRAPERS = {
  'wellfound':      () => import('./scrapers/wellfound.mjs'),
  'indeed':         () => import('./scrapers/indeed.mjs'),
  'jsearch':        () => import('./scrapers/linkedin.mjs'),
  'greenhouse-agg': () => import('./scrapers/greenhouse-agg.mjs'),
  'lever-agg':      () => import('./scrapers/lever-agg.mjs'),
  'remote-boards':  () => import('./scrapers/remote-boards.mjs'),
};

// ── Main ──

async function main() {
  console.log(`\n━━━ career-ops scan-all — ${TODAY} ━━━\n`);

  const filters = loadTitleFilters();
  const seenUrls = loadSeenUrls();

  if (!dryRun) {
    ensureHistoryFile();
    ensurePipelineFile();
  }

  const scrapersToRun = sourceFilter
    ? { [sourceFilter]: SCRAPERS[sourceFilter] }
    : SCRAPERS;

  if (sourceFilter && !SCRAPERS[sourceFilter]) {
    console.error(`Unknown source: ${sourceFilter}`);
    console.error(`Available: ${Object.keys(SCRAPERS).join(', ')}`);
    process.exit(1);
  }

  const allNew = [];
  const stats = {
    total: { found: 0, filtered: 0, duped: 0, added: 0 },
    byScraper: {},
  };

  // Run scrapers sequentially (they share Playwright browser instances internally)
  // Greenhouse/Lever aggregators are API-only so they're fast
  for (const [name, loader] of Object.entries(scrapersToRun)) {
    log('scan-all', `Starting ${name}...`);
    const scraperStats = { found: 0, filtered: 0, duped: 0, added: 0 };

    try {
      const mod = await loader();
      const results = await mod.scan();

      for (const r of results) {
        r.source = r.source || name;
        scraperStats.found++;
        stats.total.found++;

        // Title filter
        if (!matchesTitle(r.title, filters)) {
          if (!dryRun) appendToHistory(r, 'skipped_title');
          scraperStats.filtered++;
          stats.total.filtered++;
          continue;
        }

        // Dedup
        if (isDuplicate(r, seenUrls)) {
          if (!dryRun) appendToHistory(r, 'skipped_dup');
          scraperStats.duped++;
          stats.total.duped++;
          continue;
        }

        // New role — add it
        if (!dryRun) {
          appendToHistory(r, 'added');
          appendToPipeline(r);
        }
        seenUrls.add(r.url);
        seenUrls.add(`${r.company.toLowerCase()}::${r.title.toLowerCase()}`);
        scraperStats.added++;
        stats.total.added++;
        allNew.push(r);
      }
    } catch (err) {
      log('scan-all', `ERROR in ${name}: ${err.message}`);
    }

    stats.byScraper[name] = scraperStats;
    log('scan-all', `${name}: ${scraperStats.found} found → ${scraperStats.added} added (${scraperStats.filtered} filtered, ${scraperStats.duped} duped)`);
  }

  // ── Write daily digest ──

  const digestPath = join(ROOT, 'data', `new_roles_${TODAY}.md`);
  let digest = `# New Roles — ${TODAY}\n\n`;
  digest += `> Scanned ${Object.keys(scrapersToRun).length} sources. `;
  digest += `Found ${stats.total.found} candidates → ${stats.total.added} new roles added.\n\n`;

  if (allNew.length === 0) {
    digest += `No new roles found today.\n`;
  } else {
    digest += `| # | Company | Role | Location | Source | Link |\n`;
    digest += `|---|---------|------|----------|--------|------|\n`;
    allNew.forEach((r, i) => {
      // Scrapers already extract a raw location (e.g. "Remote", "Seattle, WA");
      // persist it so score-and-publish can classify Remote/Hybrid/Onsite/Unknown.
      const loc = String(r.location || '').replace(/\|/g, '/').trim();
      digest += `| ${i + 1} | ${r.company} | ${r.title} | ${loc} | ${r.source} | [View](${r.url}) |\n`;
    });
  }

  digest += `\n## Source Breakdown\n\n`;
  digest += `| Source | Found | Passed Filter | Duplicates | Added |\n`;
  digest += `|--------|-------|---------------|------------|-------|\n`;
  for (const [name, s] of Object.entries(stats.byScraper)) {
    digest += `| ${name} | ${s.found} | ${s.found - s.filtered} | ${s.duped} | ${s.added} |\n`;
  }

  if (!dryRun) {
    writeFileSync(digestPath, digest);
    log('scan-all', `Daily digest written to ${digestPath}`);
  }

  // ── Summary to stdout ──

  console.log(`\n━━━ Results ━━━\n`);
  console.log(`Sources scanned:    ${Object.keys(stats.byScraper).length}`);
  console.log(`Candidates found:   ${stats.total.found}`);
  console.log(`Passed title filter: ${stats.total.found - stats.total.filtered}`);
  console.log(`Duplicates skipped: ${stats.total.duped}`);
  console.log(`New roles added:    ${stats.total.added}`);

  if (allNew.length > 0) {
    console.log(`\nNew roles:`);
    for (const r of allNew) {
      console.log(`  + ${r.company} | ${r.title} (${r.source})`);
    }
  }

  if (dryRun) {
    console.log(`\n(dry run — nothing written to disk)`);
  } else {
    console.log(`\nDigest: data/new_roles_${TODAY}.md`);
    console.log(`Pipeline: data/pipeline.md`);
    console.log(`History: data/scan-history.tsv`);
  }

  console.log(`\n→ Run /career-ops pipeline to evaluate new roles.`);
}

main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});

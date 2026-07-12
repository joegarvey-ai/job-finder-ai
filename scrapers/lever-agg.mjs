#!/usr/bin/env node
// scrapers/lever-agg.mjs — Aggregate PM/Director roles across Lever job boards
//
// Lever doesn't have a public aggregate API like Greenhouse. However, each company's
// Lever board at jobs.lever.co/{slug} has a hidden JSON endpoint:
//   https://api.lever.co/v0/postings/{slug}?mode=json
//
// We maintain a discovery list of Lever slugs for companies in common PM-leadership target domains,
// skip any already tracked in portals.yml, and hit the JSON endpoint.

import { readFileSync } from 'fs';
import { join } from 'path';
import { log } from './lib/common.mjs';

const SOURCE = 'lever-agg';
const ROOT = join(import.meta.dirname, '..');

function getTrackedSlugs() {
  const portals = readFileSync(join(ROOT, 'portals.yml'), 'utf8');
  const slugs = new Set();
  for (const m of portals.matchAll(/jobs\.lever\.co\/([^/\s"']+)/g)) {
    slugs.add(m[1].toLowerCase());
  }
  return slugs;
}

// Discovery list: Lever companies NOT in portals.yml
const DISCOVERY_SLUGS = [
  // AI / ML
  'anthropic', 'openai', 'cohere', 'inflection', 'ai21labs', 'runway',
  'jasperai', 'writercom', 'assemblyai',
  // Data / analytics
  'looker', 'mode', 'hex', 'preset', 'lightdash', 'metabase',
  'starburst', 'dremio', 'clickhouse', 'timescale',
  // Developer tools
  'netlify', 'fly', 'render', 'railway', 'supabase', 'neon',
  'planetscale', 'cockroach-labs', 'singlestore',
  // MarTech / CRM
  'attentive', 'postscript', 'sailthru', 'movable-ink',
  'cordial', 'bluecore', 'bloomreach',
  // Enterprise productivity
  'webflow', 'sanity', 'contentful', 'strapi',
  'loom', 'calendly', 'grain', 'gong',
];

async function fetchBoard(slug) {
  const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;
  try {
    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return { slug, jobs: [] };
    const data = await resp.json();
    if (!Array.isArray(data)) return { slug, jobs: [] };
    return {
      slug,
      jobs: data.map(j => ({
        title: j.text || '',
        url: j.hostedUrl || j.applyUrl || '',
        company: slug, // Use slug as company; categories.team is usually a department
        source: SOURCE,
        location: j.categories?.location || '',
      })),
    };
  } catch {
    return { slug, jobs: [] };
  }
}

export async function scan() {
  const tracked = getTrackedSlugs();
  const slugsToScan = DISCOVERY_SLUGS.filter(s => !tracked.has(s.toLowerCase()));

  log(SOURCE, `Scanning ${slugsToScan.length} Lever boards (${tracked.size} already tracked, skipped).`);

  const results = [];
  for (let i = 0; i < slugsToScan.length; i += 10) {
    const batch = slugsToScan.slice(i, i + 10);
    const batchResults = await Promise.all(batch.map(fetchBoard));

    for (const { slug, jobs } of batchResults) {
      for (const job of jobs) {
        // Prettify slug to company name: "cockroach-labs" → "Cockroach Labs"
        if (job.company === slug) {
          job.company = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        }
        results.push(job);
      }
    }
  }

  log(SOURCE, `Fetched ${results.length} total jobs across ${slugsToScan.length} boards.`);
  return results;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ''))) {
  const results = await scan();
  console.log(JSON.stringify(results, null, 2));
}

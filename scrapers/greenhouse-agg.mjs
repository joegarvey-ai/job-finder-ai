#!/usr/bin/env node
// scrapers/greenhouse-agg.mjs — Aggregate PM/Director roles across all Greenhouse boards
//
// Strategy: Greenhouse has a public API at boards-api.greenhouse.io.
// We maintain a list of known Greenhouse slugs (extracted from portals.yml + a curated
// discovery list of companies likely to hire PM leadership). For each slug, hit the API
// and filter results by title.
//
// This is COMPLEMENTARY to the tracked_companies scan in career-ops — it discovers roles
// at companies NOT already in portals.yml.

import { readFileSync } from 'fs';
import { join } from 'path';
import { log } from './lib/common.mjs';

const SOURCE = 'greenhouse-agg';
const ROOT = join(import.meta.dirname, '..');

// Companies already tracked in portals.yml (extracted at runtime to avoid double-scanning)
function getTrackedSlugs() {
  const portals = readFileSync(join(ROOT, 'portals.yml'), 'utf8');
  const slugs = new Set();
  for (const m of portals.matchAll(/boards-api\.greenhouse\.io\/v1\/boards\/([^/]+)\/jobs/g)) {
    slugs.add(m[1]);
  }
  return slugs;
}

// Discovery list: Greenhouse companies NOT in portals.yml that might have PM leadership roles.
// Curated for common PM-leadership target domains: AI/ML, data platforms, MarTech, developer tools.
const DISCOVERY_SLUGS = [
  // AI / ML
  'anyscale', 'modal', 'replicate', 'together', 'fixie', 'adept',
  'characterai', 'jasper', 'writer', 'copy-ai', 'grammarly',
  // Data platforms
  'fivetran', 'airbyte', 'census', 'rudderstack', 'mparticle',
  'segment', 'lytics', 'treasure-data',
  // Developer tools / platforms
  'postman', 'kong', 'hashicorp', 'datadog', 'newrelic', 'pagerduty',
  'launchdarkly', 'split', 'optimizely', 'contentstack',
  // MarTech
  'klaviyo', 'customer-io', 'sendgrid', 'mailchimp', 'mailgun',
  'appcues', 'pendo', 'gainsight', 'totango', 'chameleon',
  // Enterprise / productivity
  'asana', 'monday', 'clickup', 'linear', 'shortcut',
  'coda', 'airtable', 'lucid', 'miro',
];

async function fetchBoard(slug) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
  try {
    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.jobs || []).map(j => ({
      title: j.title || '',
      url: j.absolute_url || '',
      company: data.name || slug,
      source: SOURCE,
      location: j.location?.name || '',
    }));
  } catch {
    return [];
  }
}

export async function scan() {
  const tracked = getTrackedSlugs();
  // Scan tracked companies THROUGH the ATS API too. Previously they were excluded
  // (`DISCOVERY_SLUGS.filter(s => !tracked.has(s))`), which perversely sent the
  // highest-priority (tracked) companies down the location-blind career-page path
  // while untracked companies got authoritative `j.location.name` from the API.
  // Now both sets go through the API; the Set dedupes the overlap — so tracked
  // companies also get a real location for downstream location filtering.
  const slugsToScan = [...new Set([...DISCOVERY_SLUGS, ...tracked])];

  log(SOURCE, `Scanning ${slugsToScan.length} Greenhouse boards (${tracked.size} tracked + ${DISCOVERY_SLUGS.length} discovery, deduped — tracked no longer skipped).`);

  const results = [];
  // Batch fetches 10 at a time to avoid overwhelming the API
  for (let i = 0; i < slugsToScan.length; i += 10) {
    const batch = slugsToScan.slice(i, i + 10);
    const batchResults = await Promise.all(batch.map(fetchBoard));

    for (const jobs of batchResults) {
      for (const job of jobs) {
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

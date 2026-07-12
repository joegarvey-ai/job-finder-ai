#!/usr/bin/env node
// scrapers/remote-boards.mjs — Scrape remote-focused job boards
//
// Sources:
//   - Remotive (remotive.com) — has a public JSON API
//   - We Work Remotely (weworkremotely.com) — HTML scrape
//   - Otta (otta.com/jobs) — Playwright (SPA)
//
// All filtered for PM/Director/Marketing Ops roles.

import { launchBrowser, newStealthPage, log } from './lib/common.mjs';

const SOURCE = 'remote-boards';

// ── Remotive (JSON API) ──

async function scanRemotive() {
  const results = [];
  // Remotive API: category=product for PM roles
  const url = 'https://remotive.com/api/remote-jobs?category=product&limit=50';

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) { log(SOURCE, `Remotive API returned ${resp.status}`); return []; }
    const data = await resp.json();

    for (const job of (data.jobs || [])) {
      // Only include if posted within last 14 days
      const posted = new Date(job.publication_date);
      const daysAgo = (Date.now() - posted.getTime()) / 86400000;
      if (daysAgo > 14) continue;

      results.push({
        title: job.title || '',
        company: job.company_name || '',
        url: job.url || '',
        source: 'remotive',
      });
    }
    log(SOURCE, `Remotive: ${results.length} recent product roles.`);
  } catch (err) {
    log(SOURCE, `Remotive error: ${err.message}`);
  }
  return results;
}

// ── We Work Remotely (HTML) ──

async function scanWWR() {
  const results = [];
  // WWR categories that might have PM roles
  const categories = [
    'https://weworkremotely.com/categories/remote-product-jobs',
    'https://weworkremotely.com/categories/remote-marketing-jobs',
  ];

  let browser;
  try {
    browser = await launchBrowser();
    const page = await newStealthPage(browser);

    for (const catUrl of categories) {
      try {
        await page.goto(catUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(1500);

        const jobs = await page.evaluate(() => {
          const cards = [];
          // WWR redesigned their markup — new structure uses .new-listing-container
          const items = document.querySelectorAll('li.new-listing-container');

          for (const item of items) {
            const link = item.querySelector('a[class*="listing-link"], a[href*="/remote-jobs/"]');
            if (!link) continue;

            const titleEl = link.querySelector('span.new-listing__header__title__text, h3 span');
            const companyEl = link.querySelector('p.new-listing__company-name');

            const title = titleEl?.textContent?.trim() || '';
            // Company <p> contains text + a decorative <img>; grab first text node only
            const company = companyEl
              ? Array.from(companyEl.childNodes)
                  .filter(n => n.nodeType === Node.TEXT_NODE)
                  .map(n => n.textContent.trim())
                  .join('')
                  .trim()
              : '';
            let href = link.getAttribute('href') || '';
            if (href && !href.startsWith('http')) href = `https://weworkremotely.com${href}`;

            if (title && href) cards.push({ title, company, url: href });
          }
          return cards;
        });

        results.push(...jobs.map(j => ({ ...j, source: 'weworkremotely' })));
      } catch (err) {
        log(SOURCE, `WWR category failed: ${err.message}`);
      }
    }
  } catch (err) {
    log(SOURCE, `WWR error: ${err.message}`);
  } finally {
    if (browser) await browser.close();
  }

  log(SOURCE, `WWR: ${results.length} results.`);
  return results;
}

// ── Combined scan ──

export async function scan() {
  // Run API-based scrapers in parallel, browser-based sequentially
  const [remotiveResults, wwrResults] = await Promise.all([
    scanRemotive(),
    scanWWR(),
  ]);

  const all = [...remotiveResults, ...wwrResults];
  log(SOURCE, `Total from remote boards: ${all.length}`);
  return all;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ''))) {
  const results = await scan();
  console.log(JSON.stringify(results, null, 2));
}

# Job Finder AI

> A fork of [santifer/career-ops](https://github.com/santifer/career-ops) — turnkey AI job search for non-technical users in any career field.

[English](README.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [한국어](README.ko-KR.md) | [日本語](README.ja.md) | [Русский](README.ru.md) | [简体中文](README.cn.md) | [繁體中文](README.zh-TW.md)

<p align="center">
  <a href="https://github.com/joegarvey-ai/job-finder-ai"><img src="docs/hero-banner.jpg" alt="Job Finder AI — AI-powered job search for any career field" width="800"></a>
</p>

<p align="center">
  <em>AI-powered job search that filters hundreds of listings down to the few worth applying to,<br>
  generates a tailored resume for each, and tracks every application — in any career field.</em><br>
  <strong>Set up in ~10 minutes by pasting one prompt into Claude Code. No coding required.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white" alt="Claude Code">
  <img src="https://img.shields.io/badge/OpenCode-111827?style=flat&logo=terminal&logoColor=white" alt="OpenCode">
  <img src="https://img.shields.io/badge/Gemini_CLI-4285F4?style=flat&logo=google&logoColor=white" alt="Gemini CLI">
  <img src="https://img.shields.io/badge/Codex_(soon)-6B7280?style=flat&logo=openai&logoColor=white" alt="Codex">
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white" alt="Go">
  <img src="https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white" alt="Playwright">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT">
  <a href="TRADEMARK.md"><img src="https://img.shields.io/badge/Trademark-Policy-blue.svg" alt="Trademark Policy"></a>
  <a href="https://discord.gg/8pRpHETxa4"><img src="https://img.shields.io/badge/Discord-5865F2?style=flat&logo=discord&logoColor=white" alt="Discord"></a>
  <br>
  <img src="https://img.shields.io/badge/EN-blue?style=flat" alt="EN">
  <img src="https://img.shields.io/badge/ES-red?style=flat" alt="ES">
  <img src="https://img.shields.io/badge/DE-grey?style=flat" alt="DE">
  <img src="https://img.shields.io/badge/FR-blue?style=flat" alt="FR">
  <img src="https://img.shields.io/badge/PT--BR-green?style=flat" alt="PT-BR">
  <img src="https://img.shields.io/badge/KO-white?style=flat" alt="KO">
  <img src="https://img.shields.io/badge/JA-red?style=flat" alt="JA">
  <img src="https://img.shields.io/badge/ZH--CN-red?style=flat" alt="ZH-CN">
  <img src="https://img.shields.io/badge/ZH--TW-blue?style=flat" alt="ZH-TW">
</p>

---

<p align="center">
  <img src="docs/demo.gif" alt="Career-Ops Demo" width="800">
</p>

<p align="center"><strong>The original career-ops system was used by its author to evaluate 740+ listings, generate 100+ tailored CVs, and land a Head of Applied AI role. This fork makes that workflow available to anyone, in any field, with no coding.</strong></p>

<p align="center"><a href="https://discord.gg/8pRpHETxa4"><img src="https://img.shields.io/badge/Join_the_community-Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a></p>

> **Naming note:** This repo is `job-finder-ai` (this fork). The tool inside is named `career-ops` — that's the original upstream tool ([santifer/career-ops](https://github.com/santifer/career-ops), MIT) that this fork extends. When you see `/career-ops` slash commands or references to "career-ops" in code and docs, they refer to this project. Same thing, two names.

## Setup

You don't need to know how to use a terminal. Two paths:

### Path A — Zero-touch (recommended for everyone)

**Prerequisites (one-time):** Install [Node.js 18+](https://nodejs.org) and [Claude Code](https://docs.claude.com/claude-code). That's it. The rest is done in Claude Code itself.

Open Claude Code (run `claude` in any folder — or double-click [`start-career-ops.command`](start-career-ops.command) on macOS / [`start-career-ops.bat`](start-career-ops.bat) on Windows after cloning) and paste this — **edit the bracketed bits for your situation**:

> Clone `https://github.com/joegarvey-ai/job-finder-ai` into a sensible folder (e.g., `~/Projects/`). After it clones, run `bash bootstrap.sh` to install dependencies and seed config files. Then read `AGENTS.md` and walk me through the First Run onboarding. I'm a **[your field — e.g., "financial analyst", "marketing manager", "backend engineer", "product designer", "healthcare administrator"]** targeting **[your target roles — e.g., "Senior FP&A roles", "Demand Gen Lead positions", "Staff backend engineer roles"]**. Pull my resume and target companies from this background: [paste your resume text, LinkedIn summary, or a few paragraphs about your career].

Claude Code will:
1. Clone the repo
2. Run `bootstrap.sh` (Node check, `npm install`, Playwright install, seed templates, run doctor)
3. Read AGENTS.md
4. Fill in `cv.md`, `config/profile.yml`, `modes/_profile.md`, and `portals.yml` for **your field** — not the original author's AI/PM defaults
5. Ask you a few clarifying questions (comp range, location policy, deal-breakers)
6. Optionally set up a recurring scan via `/schedule`

Total time: ~5-10 minutes including the conversational steps.

> **Brand new to this stuff?** See [INSTALL.md](INSTALL.md) for a 3-step quickstart, or [docs/SETUP-FOR-BEGINNERS.md](docs/SETUP-FOR-BEGINNERS.md) for the slow walkthrough with screenshots-worth of detail.

### Path B — Manual setup (if you prefer the terminal)

If you'd rather drive the terminal yourself:

```bash
git clone https://github.com/joegarvey-ai/job-finder-ai.git ~/Projects/job-finder-ai
cd ~/Projects/job-finder-ai
bash bootstrap.sh        # or: .\bootstrap.ps1 on Windows
claude                   # then say: "set me up using AGENTS.md, I'm a [field]"
```

### Customization is conversational

After setup, every customization is a sentence to Claude. Examples:

- "Add Goldman Sachs, JPMorgan, and Morgan Stanley to my portals.yml"
- "Change my comp floor to $180K total"
- "I don't want to evaluate any roles requiring travel"
- "Rewrite my archetypes for senior FP&A leadership instead of mid-level"

Claude reads the same files it uses, so it can edit them directly.

---

## New in This Fork

> Forked from [santifer/career-ops](https://github.com/santifer/career-ops). See [FORK_NOTES.md](FORK_NOTES.md) for full details.

| Addition | What it does |
|----------|-------------|
| **Zero-touch setup** | `bootstrap.sh` / `bootstrap.ps1` + `start-career-ops.command/.bat` desktop launchers. Setup is "paste a prompt into Claude Code" with no manual file edits |
| **Field-agnostic templates** | `_profile.template.md` and `portals.example.yml` work for any career (finance, marketing, design, sales, ops, healthcare, engineering) instead of assuming AI/PM |
| **JSearch API integration** | Aggregates LinkedIn + Indeed + Glassdoor in one call (free tier: 200 req/month) |
| **Greenhouse/Lever aggregators** | Scans 100+ ATS boards via public APIs — no browser, no LLM cost |
| **Wellfound route interception** | Captures internal API responses instead of scraping DOM — survives redesigns |
| **Indeed RSS/HTML fallback** | Structured feed parser (Indeed WAF blocks it; JSearch covers the gap) |
| **We Work Remotely scraper** | Updated selectors for WWR's 2026 redesign with company name extraction |
| **Remotive API scraper** | JSON API for remote-focused roles |
| **Dynamic slug discovery** | `discover-ats-slugs.mjs` auto-finds new Greenhouse/Lever boards monthly |
| **Title-level scoring** | `score-and-publish.mjs` scores all scraped roles against your profile and publishes to Obsidian (opt-in) |
| **Obsidian sync (optional)** | Auto-sync pipeline and evaluation reports to an Obsidian vault — set `OBSIDIAN_VAULT_PATH` in `.env` |
| **SSRF defense** | Liveness checker rejects private/loopback/metadata-service hosts before fetching |
| **Eval harness** | `evals/` golden-set regression tests for the LLM evaluator (uses free Gemini tier) |
| **English evaluation mode** | `modes/oferta.md` translated to English with customizable archetype detection |

---

## What Is This

Career-ops turns any AI coding CLI into a full job search command center. Instead of manually tracking applications in a spreadsheet, you get an AI-powered pipeline that:

- **Evaluates offers** with a structured A-G scoring system (weighted dimensions + posting-legitimacy check)
- **Generates tailored PDFs** -- ATS-optimized CVs customized per job description
- **Scans portals** automatically (Greenhouse, Ashby, Lever, company pages)
- **Processes in batch** -- evaluate 10+ offers in parallel with sub-agents
- **Tracks everything** in a single source of truth with integrity checks

> **Important: This is NOT a spray-and-pray tool.** Career-ops is a filter -- it helps you find the few offers worth your time out of hundreds. The system strongly recommends against applying to anything scoring below 4.0/5. Your time is valuable, and so is the recruiter's. Always review before submitting.

It's agentic: Claude Code navigates career pages with Playwright, evaluates fit by reasoning about your CV vs the job description (not keyword matching), and adapts your resume per listing.

> **Heads up: the first evaluations won't be great.** The system doesn't know you yet. Feed it context -- your CV, your career story, your proof points, your preferences, what you're good at, what you want to avoid. The more you nurture it, the better it gets. Think of it as onboarding a new recruiter: the first week they need to learn about you, then they become invaluable.

## Features

| Feature | Description |
|---------|-------------|
| **Auto-Pipeline** | Paste a URL, get a full evaluation + PDF + tracker entry |
| **A-G Evaluation** | Role summary, CV match, level strategy, comp research, personalization, interview prep (STAR+R), posting legitimacy |
| **Interview Story Bank** | Accumulates STAR+Reflection stories across evaluations -- 5-10 master stories that answer any behavioral question |
| **Negotiation Scripts** | Salary negotiation frameworks, geographic discount pushback, competing offer leverage |
| **ATS PDF Generation** | Keyword-injected CVs with Space Grotesk + DM Sans design |
| **Portal Scanner** | Pre-configured companies + custom queries across Ashby, Greenhouse, Lever, Wellfound |
| **Batch Processing** | Parallel evaluation with `claude -p` workers |
| **Dashboard TUI** | Terminal UI to browse, filter, and sort your pipeline |
| **Human-in-the-Loop** | AI evaluates and recommends, you decide and act. The system never submits an application -- you always have the final call |
| **Pipeline Integrity** | Automated merge, dedup, status normalization, health checks |

### Custom scrapers (this fork)

The deterministic Node.js scrapers run without LLM cost. They hit Greenhouse/Lever/JSearch/Wellfound APIs directly:

```bash
npm run scan-all                  # All 6 scrapers
npm run scan:greenhouse           # 55+ Greenhouse boards via API
npm run scan:jsearch              # LinkedIn + Indeed + Glassdoor (needs JSEARCH_API_KEY in .env)
npm run scan:wellfound            # Wellfound via route interception
```

JSearch API key: copy `.env.example` to `.env` and add `JSEARCH_API_KEY=...` ([free key from RapidAPI](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch)).

### Obsidian sync (optional)

If you use Obsidian and want a scored, ranked, auto-updating job table inside your vault: copy `.env.example` to `.env` and set `OBSIDIAN_VAULT_PATH=/path/to/your/vault`. Then `node score-and-publish.mjs` will write a scored table into your vault. If you don't use Obsidian, you can ignore this — career-ops works fine without it.

For automation (scan every N days), see Part 7 of [docs/SETUP-FOR-BEGINNERS.md](docs/SETUP-FOR-BEGINNERS.md).

## Gemini CLI Integration

Career-ops supports [Gemini CLI](https://github.com/google-gemini/gemini-cli) natively — the same way it supports Claude Code and OpenCode. All 15 slash commands are available, using the same `modes/*.md` evaluation logic.

### Option A — Native Gemini CLI (Recommended)

```bash
# 1. Install Gemini CLI
npm install -g @google/gemini-cli
# or: npx @google/gemini-cli --version

# 2. Authenticate (free — uses your Google account)
gemini auth

# 3. Run in the career-ops directory
cd career-ops
gemini

# 4. Use slash commands just like Claude Code
/career-ops "[paste a job URL or job description text here]"
/career-ops-evaluate --file ./jds/some-role.txt
/career-ops-scan
/career-ops-pdf
/career-ops-tracker
```

The `GEMINI.md` file is auto-loaded as context. All 15 commands are defined in `.gemini/commands/*.toml`.

### Option B — Standalone API Script (No CLI install needed)

```bash
# 1. Get a free API key at https://aistudio.google.com/apikey
cp .env.example .env
# Edit .env → set GEMINI_API_KEY=your_key_here

# 2. Install dependencies
npm install

# 3. Evaluate a job description
node gemini-eval.mjs "[paste a job description here]"
node gemini-eval.mjs --file ./jds/my-job.txt
npm run gemini:eval -- "JD text here"
```

> **Free tier:** Both options work without billing. Native CLI uses Google OAuth; the API script uses `gemini-2.5-flash` (15 RPM, 1M tokens/day free).

## Usage

Career-ops is a single slash command with multiple modes:

```
/career-ops                → Show all available commands
/career-ops {paste a JD}   → Full auto-pipeline (evaluate + PDF + tracker)
/career-ops scan           → Scan portals for new offers
/career-ops pdf            → Generate ATS-optimized CV
/career-ops batch          → Batch evaluate multiple offers
/career-ops tracker        → View application status
/career-ops apply          → Fill application forms with AI
/career-ops pipeline       → Process pending URLs
/career-ops contacto       → LinkedIn outreach message
/career-ops deep           → Deep company research
/career-ops training       → Evaluate a course/cert
/career-ops project        → Evaluate a portfolio project
```

Or just paste a job URL or description directly -- career-ops auto-detects it and runs the full pipeline.

## How It Works

```
You paste a job URL or description
        │
        ▼
┌──────────────────┐
│  Archetype       │  Classifies the role against archetypes YOU defined
│  Detection       │  in modes/_profile.md (your field, your levels)
└────────┬─────────┘
         │
┌────────▼─────────┐
│  A-G Evaluation  │  Role match, CV gaps, comp research, STAR+R stories,
│  (reads cv.md)   │  posting legitimacy — scored against your profile
└────────┬─────────┘
         │
    ┌────┼────┐
    ▼    ▼    ▼
 Report  PDF  Tracker
  .md   .pdf   .md
```

## Pre-configured Portals

The scanner ships with an **example list of ~100 companies and search queries** drawn from the original AI/PM-focused upstream. **This is a starting point, not a universal target list.** During First Run onboarding, Claude Code rewrites `portals.yml` for your field — companies, search keywords, and title filters appropriate to where you actually work.

Examples of what onboarding might produce per field:

- **Finance / FP&A:** Goldman Sachs, JPMorgan, Morgan Stanley, BlackRock, Bridgewater, Citadel, fintechs (Stripe, Plaid, Brex), F500 corporate finance teams
- **Marketing / Demand Gen:** HubSpot, Salesforce, Klaviyo, Iterable, Braze, Adobe, Marketo, brand-side at consumer companies
- **Design:** Figma, Notion, Linear, Vercel, Stripe, Airbnb design teams, design consultancies
- **Sales / Customer Success:** large SaaS (Datadog, Snowflake, Atlassian), mid-market sales orgs, account-executive shops
- **Operations:** consultancies (BCG, McKinsey, Bain BizOps), F500 operations, scale-stage startups
- **Engineering:** what's in the default list works for many engineering roles; pruning is still helpful

**Job boards searched:** Greenhouse, Ashby, Lever, Wellfound, Workable, RemoteOK, Himalayas, WeWorkRemotely, RemoteFront. The site-filter queries in `portals.yml` work for any field — only the keywords need adjusting.

## Dashboard TUI

The built-in terminal dashboard lets you browse your pipeline visually:

```bash
cd dashboard
go build -o career-dashboard .
./career-dashboard --path ..
```

Features: 6 filter tabs, 4 sort modes, grouped/flat view, lazy-loaded previews, inline status changes.

## Project Structure

```
career-ops/
├── AGENTS.md                    # Canonical agent instructions (all CLIs)
├── CLAUDE.md                    # Claude Code wrapper (imports AGENTS.md)
├── cv.example.md                # Template CV (copy to cv.md)
├── article-digest.md            # Your proof points (optional)
├── config/
│   └── profile.example.yml      # Template for your profile
├── modes/                       # 14 skill modes
│   ├── _shared.md               # Shared context (auto-updatable)
│   ├── _profile.template.md     # Template for your archetypes (copy to _profile.md)
│   ├── oferta.md                # Single evaluation (English)
│   ├── pdf.md                   # PDF generation
│   ├── scan.md                  # Portal scanner
│   ├── batch.md                 # Batch processing
│   └── ...
├── scrapers/                    # Custom job scrapers (this fork)
│   ├── lib/common.mjs           # Shared: filters, dedup, TSV, browser helpers
│   ├── greenhouse-agg.mjs       # Greenhouse API aggregator (55+ boards)
│   ├── lever-agg.mjs            # Lever API aggregator (43+ boards)
│   ├── linkedin.mjs             # JSearch RapidAPI (LinkedIn+Indeed+Glassdoor)
│   ├── indeed.mjs               # Indeed HTML fetch (degraded; JSearch covers)
│   ├── wellfound.mjs            # Wellfound route interception
│   └── remote-boards.mjs        # Remotive API + We Work Remotely
├── scan-all.mjs                 # Master scraper orchestrator
├── score-and-publish.mjs        # Score roles + publish to Obsidian
├── discover-ats-slugs.mjs       # Monthly ATS slug discovery
├── templates/
│   ├── cv-template.html         # ATS-optimized CV template
│   ├── portals.example.yml      # Scanner config template
│   └── states.yml               # Canonical statuses
├── batch/
│   ├── batch-prompt.md          # Self-contained worker prompt
│   └── batch-runner.sh          # Orchestrator script
├── dashboard/                   # Go TUI pipeline viewer
├── data/                        # Your tracking data (gitignored)
├── reports/                     # Evaluation reports (gitignored)
├── output/                      # Generated PDFs (gitignored)
├── fonts/                       # Space Grotesk + DM Sans
├── docs/                        # Setup, customization, architecture
├── FORK_NOTES.md                # What changed from upstream
└── examples/                    # Sample CV, report, proof points
```

## Tech Stack

![Claude Code](https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white)
![Bubble Tea](https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white)

- **Agent**: Claude Code with custom skills and modes
- **PDF**: Playwright/Puppeteer + HTML template
- **Scanner**: Playwright + Greenhouse API + WebSearch
- **Dashboard**: Go + Bubble Tea + Lipgloss (Catppuccin Mocha theme)
- **Data**: Markdown tables + YAML config + TSV batch files

## About This Fork

Maintained by Joe Garvey ([github.com/joegarvey-ai](https://github.com/joegarvey-ai)). The fork extends the original career-ops in these directions:

- **Zero-touch setup for non-technical users.** `bootstrap.sh` / `.ps1`, `start-career-ops.command` / `.bat` desktop launchers, and a paste-into-Claude install flow (see `INSTALL.md`).
- **Field-agnostic templates and onboarding.** The upstream archetypes assume AI/Product Management. The fork's `_profile.template.md` and `portals.example.yml` work for any career (finance, marketing, design, sales, ops, healthcare admin, engineering, etc.), and AGENTS.md's onboarding flow customizes templates per field rather than leaving AI defaults in place.
- **Custom scrapers.** Greenhouse / Lever / Wellfound / JSearch (LinkedIn + Indeed + Glassdoor via RapidAPI) / Remotive / WeWorkRemotely scrapers that run with zero LLM cost on a cron schedule. See `scrapers/` and `scan-all.mjs`.
- **SSRF defense in the liveness checker** so URL probes can't be exploited via private/loopback/metadata-service hosts.
- **Optional Obsidian publishing** for users who want a scored, ranked, auto-updating job table inside their vault (`score-and-publish.mjs`, opt-in via `OBSIDIAN_VAULT_PATH` in `.env`).
- **Eval harness** for the LLM evaluator (`evals/`) — golden-set regression cases using the free Gemini tier.

See [FORK_NOTES.md](FORK_NOTES.md) for the full upstream-vs-fork change log.

## About the Original Author

Career-ops was built by Santiago Fernández de Valderrama ([santifer/career-ops](https://github.com/santifer/career-ops)) — Head of Applied AI, former founder — who used it to manage his own job search and land his current role. Santiago's portfolio and other open-source projects: [santifer.io](https://santifer.io).

This fork is published under the same MIT license and respects the upstream trademark policy.

## Star History

<a href="https://www.star-history.com/?repos=joegarvey-ai%2Fjob-finder-ai,santifer%2Fcareer-ops&type=timeline&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=joegarvey-ai/job-finder-ai,santifer/career-ops&type=timeline&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=joegarvey-ai/job-finder-ai,santifer/career-ops&type=timeline&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=joegarvey-ai/job-finder-ai,santifer/career-ops&type=timeline&legend=top-left" />
 </picture>
</a>

## Disclaimer

**career-ops is a local, open-source tool — NOT a hosted service.** By using this software, you acknowledge:

1. **You control your data.** Your CV, contact info, and personal data stay on your machine and are sent directly to the AI provider you choose (Anthropic, OpenAI, etc.). We do not collect, store, or have access to any of your data.
2. **You control the AI.** The default prompts instruct the AI not to auto-submit applications, but AI models can behave unpredictably. If you modify the prompts or use different models, you do so at your own risk. **Always review AI-generated content for accuracy before submitting.**
3. **You comply with third-party ToS.** You must use this tool in accordance with the Terms of Service of the career portals you interact with (Greenhouse, Lever, Workday, LinkedIn, etc.). Do not use this tool to spam employers or overwhelm ATS systems.
4. **No guarantees.** Evaluations are recommendations, not truth. AI models may hallucinate skills or experience. The authors are not liable for employment outcomes, rejected applications, account restrictions, or any other consequences.

See [LEGAL_DISCLAIMER.md](LEGAL_DISCLAIMER.md) for full details. This software is provided under the [MIT License](LICENSE) "as is", without warranty of any kind.

## Contributors

This fork (`joegarvey-ai/job-finder-ai`):

<a href="https://github.com/joegarvey-ai/job-finder-ai/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=joegarvey-ai/job-finder-ai" />
</a>

Upstream (`santifer/career-ops`):

<a href="https://github.com/santifer/career-ops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=santifer/career-ops" />
</a>

Landed a role using this tool? [Open an issue](https://github.com/joegarvey-ai/job-finder-ai/issues/new) — happy to hear about it.

## License & Trademark

The code is licensed under [MIT](LICENSE). The "career-ops" name and
brand are governed by the [Trademark Policy](TRADEMARK.md) — permissive
for community use, reserved for commercial product naming and
endorsement.

Built on [santifer/career-ops](https://github.com/santifer/career-ops) -- MIT License.

## Connect with the Original Author

[![Website](https://img.shields.io/badge/santifer.io-000?style=for-the-badge&logo=safari&logoColor=white)](https://santifer.io)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/santifer)
[![X](https://img.shields.io/badge/X-000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/santifer)
[![Discord](https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/8pRpHETxa4)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:hi@santifer.io)

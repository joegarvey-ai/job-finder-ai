# Install (3 steps, ~10 minutes)

This is the absolute shortest path to using career-ops. If you've never touched a terminal, this is for you.

---

## Step 1 — Install Node.js

Go to **[nodejs.org](https://nodejs.org)** and download the **LTS** version. Run the installer. Click through with default settings.

To confirm it worked, open Terminal (macOS) or PowerShell (Windows) and run:
```
node --version
```
You should see a version like `v22.x.x`.

---

## Step 2 — Install Claude Code

Go to **[docs.claude.com/claude-code](https://docs.claude.com/claude-code)** and follow the install instructions for your OS.

To confirm it worked:
```
claude --version
```

You'll need an Anthropic account when you first run it. Free tier may have limits — see [anthropic.com/pricing](https://www.anthropic.com/pricing) for plans.

---

## Step 3 — Paste this into Claude Code

Run `claude` in any folder. When it opens, paste the prompt below — **edit the bracketed bits to describe yourself first**:

> Clone `https://github.com/joegarvey-ai/job-finder-ai` into `~/Projects/`. After it clones, run `bash bootstrap.sh` to install dependencies and seed config files. Then read `AGENTS.md` and walk me through First Run onboarding.
>
> I'm a **[your field — e.g., "financial analyst", "marketing manager", "backend engineer", "product designer", "healthcare administrator", "sales engineer"]** targeting **[your target roles — e.g., "Senior FP&A and Strategic Finance positions", "Demand Generation Lead and MarTech Director roles", "Staff backend engineer roles at series B+ startups"]**.
>
> Here is my background to pull from: **[paste your resume text, your LinkedIn profile summary, or 2-3 paragraphs about your career and experience]**.

Claude Code will clone the repo, install everything, set up your CV / profile / archetypes / target companies for **your field** (not the AI/Product Management defaults this repo ships with), and ask a few clarifying questions about compensation, location preferences, and deal-breakers.

---

## After install

To use the tool any time:

- **macOS**: double-click `start-career-ops.command` in the `~/Projects/job-finder-ai` folder.
- **Windows**: double-click `start-career-ops.bat` in the `~/Projects/job-finder-ai` folder.
- **Or from any terminal**: `cd ~/Projects/job-finder-ai && claude`

Once Claude Code is open, paste a job URL to evaluate it, or type `/career-ops` to see all available commands.

---

## What if something goes wrong?

Run `npm run doctor` from inside the project folder — it tells you exactly what's missing and how to fix it.

The full troubleshooting guide is in **[docs/SETUP-FOR-BEGINNERS.md](docs/SETUP-FOR-BEGINNERS.md)** (Parts 7-8 cover automation and the Claude Desktop last-mile flow).

---

## What about "career-ops" vs "job-finder-ai"?

You'll see both names in the project. They refer to the same thing:

- **`job-finder-ai`** is the name of *this fork's GitHub repo*.
- **`career-ops`** is the name of the *tool inside the repo* (originally built by [santifer/career-ops](https://github.com/santifer/career-ops), MIT-licensed, extended here).

When you type `/career-ops` slash commands in Claude Code, that's the tool name. When you reference the GitHub URL, that's the repo name. Both work.

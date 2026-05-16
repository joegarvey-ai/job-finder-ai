# Setup Guide for Beginners

This is the slow-and-careful version of the setup. If you've never used a terminal, never run `npm`, and don't know what a git repo is — this guide is for you. You'll be running your first job evaluation in about 30 minutes.

If you're already comfortable with the terminal, see [SETUP.md](SETUP.md) instead.

---

## TL;DR — the fastest path

If you can install two apps and copy-paste a prompt, you don't need to read the rest of this guide.

1. Install **Node.js 18+** from [nodejs.org](https://nodejs.org) (download the "LTS" version, run the installer with default settings).
2. Install **Claude Code** from [docs.claude.com/claude-code](https://docs.claude.com/claude-code).
3. Open Claude Code (search "Claude Code" in your launcher, or run `claude` in any terminal).
4. Paste this — replace the bracketed bits:

   > Clone `https://github.com/joegarvey-ai/job-finder-ai` into `~/Projects/`. After cloning, run `bash bootstrap.sh` to install dependencies. Then read `AGENTS.md` and walk me through the First Run onboarding. I'm a **[your field, e.g., "financial analyst"]** targeting **[your roles, e.g., "Senior FP&A and Strategic Finance positions"]**. My background: **[paste your resume text or LinkedIn summary, or describe your career in 2-3 paragraphs]**.

5. Answer Claude Code's follow-up questions (target companies, comp range, location policy). It will fill in your `cv.md`, profile, archetypes, and target-company list for your field — not the AI/PM defaults this repo ships with.

Total time: ~10 minutes including the conversational steps. **You never have to edit code or YAML by hand.**

If anything goes wrong, the slow walkthrough below (Parts 1-8) covers every detail.

---

## What you're about to install

You're going to install a tool that **uses AI to find and evaluate jobs for you**. Specifically:

1. **A coding assistant** called Claude Code that runs in your terminal. You'll talk to it in plain English and it will read job postings, score them against your background, generate tailored resumes, and track applications.
2. **This project** (career-ops) which is the "playbook" Claude Code follows. It's a folder of instructions, templates, and helpers.

You don't need to know how to code. You'll only type the commands shown in this guide and then talk to Claude Code in normal English.

---

## Part 1 — Install the prerequisites (one-time)

You need three things installed on your computer before career-ops will run:

1. **Node.js** — runs the helper scripts
2. **Claude Code** — the AI assistant
3. **Git** — downloads this project

### macOS

Open the Terminal app (press `⌘+Space`, type "Terminal", press Enter).

**Install Node.js:**
- Go to [nodejs.org](https://nodejs.org) and download the "LTS" version.
- Open the downloaded `.pkg` file and click through the installer (default settings are fine).
- Back in Terminal, run this to verify it worked:
  ```bash
  node --version
  ```
  You should see something like `v22.x.x` or higher. If you see `command not found`, close and re-open Terminal and try again.

**Install Claude Code:**
- Run this single command in Terminal:
  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  ```
- Close and re-open Terminal.
- Verify it worked:
  ```bash
  claude --version
  ```
- The first time you run `claude` (a few steps from now), it will ask you to log in with your Anthropic account.

**Install Git:**
- Run this:
  ```bash
  git --version
  ```
  If a version number appears, you already have it (macOS ships with git). If a popup appears asking you to install Xcode Command Line Tools, click "Install" and wait — that gives you git.

### Windows

Open PowerShell (press `Win`, type "PowerShell", press Enter).

**Install Node.js:**
- Go to [nodejs.org](https://nodejs.org) and download the "LTS" Windows installer.
- Run the `.msi` installer and click through with default settings.
- Close and re-open PowerShell, then verify:
  ```powershell
  node --version
  ```

**Install Claude Code:**
- Follow the Windows instructions at [docs.claude.com/claude-code](https://docs.claude.com/claude-code).
- Close and re-open PowerShell.
- Verify:
  ```powershell
  claude --version
  ```

**Install Git:**
- Go to [git-scm.com/downloads](https://git-scm.com/downloads) and run the Windows installer with default settings.

### Linux

If you're on Linux you probably know your package manager. Install `nodejs` (v18+), `git`, then install Claude Code via:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

---

## Part 2 — Download career-ops

Pick a folder where you want to keep this project. The Desktop is a fine place if you're not sure.

In your terminal, navigate there:

```bash
cd ~/Desktop
```

Then download (clone) the project:

```bash
git clone https://github.com/joegarvey-ai/job-finder-ai.git
cd job-finder-ai
```

You should now be inside the `job-finder-ai` folder. To confirm:

```bash
pwd
```
You should see a path ending in `job-finder-ai`.

---

## Part 3 — Install the project's dependencies

Run the bootstrap script. It installs everything, seeds the config files from templates, runs a health check, and tells you what to do next.

**macOS / Linux:**
```bash
bash bootstrap.sh
```

**Windows (PowerShell):**
```powershell
.\bootstrap.ps1
```

The script takes 2-5 minutes total. It's safe to re-run if it fails partway. When it finishes you'll see "Bootstrap complete" with next-step instructions.

---

## Part 4 — Health check (already done — bootstrap ran it for you)

The bootstrap script ran `npm run doctor` at the end. You should have seen a list of checks with green `✓` marks. Yellow `!` warnings for "cv.md not customized" are expected — Claude Code will fix that for you in the next step. As long as there are no red `✗` blockers, you're ready.

If you ever want to re-run the health check manually:
```bash
npm run doctor
```

---

## Part 5 — First session with Claude Code

This is where the magic starts. From inside `job-finder-ai`, run:

```bash
claude
```

**macOS tip:** instead of typing `claude`, you can double-click `start-career-ops.command` in Finder. It opens a terminal in this folder and runs `claude` for you. Right-click → Open the first time (Gatekeeper flags unsigned scripts) — after that, regular double-click works.

**Windows tip:** double-click `start-career-ops.bat` in File Explorer.

If this is your first time using Claude Code, it will open a browser window to log in. Sign in with your Anthropic account (the same one you use for claude.ai). You may need a paid plan to use Claude Code regularly — see [Anthropic's pricing](https://www.anthropic.com/pricing).

Once logged in, you'll be in Claude Code. **The first thing to type is:**

> I'm new to career-ops. Read AGENTS.md and walk me through First Run onboarding. I'm a **[your field, e.g., "marketing operations manager"]** targeting **[your roles, e.g., "Director of MarTech and Marketing Ops Lead positions"]**. Here's my background: **[paste your resume text or LinkedIn summary]**.

Claude Code will do the rest:

1. Confirm your field (so it picks the right archetypes, not the default AI/PM ones)
2. Fill in your `cv.md` from your pasted background
3. Fill in `config/profile.yml` with your details
4. Fill in `modes/_profile.md` with 3-6 archetypes appropriate for your field — replacing the AI/PM examples
5. Customize `portals.yml` with title filters, keywords, and target companies for your field
6. Confirm everything is set up

You're now ready to evaluate a job. **Paste any job URL or job description** into the chat and Claude Code will:

- Score the role against your background (0–5)
- Write a detailed evaluation report
- Generate a tailored CV in PDF form
- Add the role to your application tracker

---

## Part 6 — Your daily workflow

Each time you want to use career-ops:

1. Open Terminal
2. `cd ~/Desktop/job-finder-ai` (wherever you cloned it)
3. `claude`
4. Type a job URL, or any of these commands:

   | Type this | What it does |
   |-----------|--------------|
   | `/career-ops` | Show all commands |
   | (paste a job URL) | Evaluate the role, write report, make PDF |
   | `/career-ops scan` | Search portals for new openings |
   | `/career-ops tracker` | See all your applications |
   | `/career-ops apply` | Help you fill an application form |
   | `/career-ops pdf` | Regenerate your CV in PDF |
   | `/career-ops patterns` | Analyze rejection patterns |

---

## Part 7 — Automation (optional but recommended)

The whole point of the system is that **new jobs show up in your tracker without you doing anything**. Once a week (or every few days) it scans the portals, dedupes against what you've already seen, and adds new listings to `data/pipeline.md`. You then log in, review the digest, and pick which ones to evaluate.

You have three ways to set this up. Pick the one that matches your comfort level.

### Option A — Inside Claude Code (easiest, no terminal needed after setup)

Claude Code has a built-in `/schedule` skill. Inside Claude Code, just type:

```
/schedule every 3 days at 9am /career-ops scan
```

That's it. Claude Code will run the scan command on the schedule you set. No cron files, no Task Scheduler. You can also say it in plain English:

> "Schedule a scan every 3 days at 9am."

To see your scheduled tasks: `/schedule list`. To remove one: `/schedule remove <id>`.

The catch: this only works while Claude Code is running on your machine. If you reboot, restart Claude Code and the schedule resumes.

### Option B — macOS / Linux cron or launchd

If you want the scan to run even when Claude Code isn't open, use system-level scheduling.

```bash
# Copy the template and edit the path inside it:
cp scan-and-sync.example.sh scan-and-sync.sh
chmod +x scan-and-sync.sh
# Edit scan-and-sync.sh and set CAREER_OPS_DIR to your actual clone path.

# Test it once manually:
./scan-and-sync.sh
```

Now set it to run on a schedule.

**macOS (launchd) — preferred:**
```bash
# Edit your crontab and add a line for every-3-days at 9am:
crontab -e
# Then paste this (replace $HOME/Projects with your actual clone path):
# 0 9 */3 * *  $HOME/Projects/job-finder-ai/scan-and-sync.sh
```

**Linux (cron):** same `crontab -e` command and same line.

The log file `data/scan-and-sync.log` will show what happened each run.

### Option C — Windows Task Scheduler

```powershell
# Copy the PowerShell template and edit the path inside it:
Copy-Item scan-and-sync.example.ps1 scan-and-sync.ps1
# Edit scan-and-sync.ps1 and set $CareerOpsDir to your actual clone path.

# Test it once:
.\scan-and-sync.ps1
```

Then open Task Scheduler (search "Task Scheduler" in Start), click "Create Basic Task":
- **Name:** career-ops scan
- **Trigger:** Daily, recur every 3 days, start at 9:00 AM
- **Action:** Start a program
  - **Program:** `powershell.exe`
  - **Arguments:** `-ExecutionPolicy Bypass -File "C:\Users\YourName\Projects\job-finder-ai\scan-and-sync.ps1"`
  - **Start in:** `C:\Users\YourName\Projects\job-finder-ai`

### What runs during an automated scan?

1. The Node.js scrapers (Greenhouse, Lever, Wellfound, JSearch if you set up a key, plus remote boards) — fast, no AI cost.
2. Claude Code does an LLM scan over the companies in your `portals.yml` — small AI cost.
3. New roles get appended to `data/pipeline.md` and `data/new_roles_YYYY-MM-DD.md` (the daily digest).

The automation does NOT evaluate or score the new roles — that's done on-demand when you say "evaluate this URL" inside Claude Code. So your token bill stays predictable.

---

## Part 8 — The last mile: tailoring your resume in Claude Desktop

Career-ops in Claude Code handles discovery, scoring, and evaluation. But the *application itself* — picking a top-ranked role, reading the full JD carefully, tailoring your resume word-by-word to match it, and producing a Word doc you can submit — is best done in **Claude Desktop**.

Why a different tool for this step?

- **.docx output.** Claude Code generates PDFs (and optionally LaTeX). Most applications want a Word doc. Claude Desktop can produce .docx directly via filesystem MCPs or by writing the file for you.
- **Friendlier review UX.** Tweaking a paragraph until it sings is easier in a chat window than a CLI.
- **Hard separation between "automated" and "actually applying."** The system is designed so that nothing is submitted without you explicitly choosing to. Keeping the apply step in a separate tool reinforces that.

### One-time setup

1. Install **Claude Desktop** from [claude.ai/download](https://claude.ai/download).
2. **Give Desktop access to your career-ops folder.** This is the key step.
   - In Claude Desktop, open Settings → Connectors (or MCP Servers, depending on version).
   - Add a filesystem connector pointing to your career-ops folder (e.g., `~/Projects/job-finder-ai`). Desktop will then be able to read your `data/`, `reports/`, `cv.md`, and `_profile.md`.
   - If filesystem MCP isn't an option, the fallback is to paste content into the chat manually.
3. (Optional) Add a **Microsoft Word MCP** if you want Desktop to write `.docx` files directly. Search the MCP registry for one — there are several community options. If you don't add one, Desktop can still produce the content as markdown and you paste it into Word.

### The handoff workflow

After Claude Code has done its weekly scan and ranking, the relevant files are:

| File | What's in it |
|------|--------------|
| `data/pipeline.md` | All newly discovered roles, not yet evaluated |
| `data/new_roles_YYYY-MM-DD.md` | The latest scan's digest (most recent first) |
| `reports/` | Full evaluations for roles you've asked Claude Code to evaluate |
| `data/applications.md` | Your tracker — what's evaluated, what's applied to |
| `cv.md` | Your canonical resume |
| `modes/_profile.md` | Your archetypes, narrative, comp targets, deal-breakers |

In Claude Desktop, start a new conversation and use a prompt like:

> "I want to apply to this job: [paste the URL or paste the JD].
>
> First, read my resume at `~/Projects/job-finder-ai/cv.md` and my profile context at `~/Projects/job-finder-ai/modes/_profile.md`. If there's an evaluation report for this role at `~/Projects/job-finder-ai/reports/` already, read that too.
>
> Then produce a tailored version of my resume as a `.docx` that:
> - Mirrors the language and keywords from the JD (without fabricating experience)
> - Reorders bullet points to lead with the most JD-relevant proof points
> - Keeps the same structure as my canonical CV
>
> Show me a side-by-side diff of what changed before saving the file."

Desktop will then read the files, draft the tailored resume, show you the diffs, and (if you have a Word MCP) save the `.docx` to a location you specify. Without a Word MCP, you'll get the content as markdown and a `.docx` won't be produced automatically — you can copy-paste into Word as a fallback.

### Final review before clicking submit

Always do this manually, in the application portal:

1. Open the saved `.docx` in Word/Pages and skim for hallucinations — AI sometimes invents skills, certifications, or job dates. Verify every line is factually true.
2. Compare against the JD requirements one more time.
3. Customize the cover letter / application questions yourself (Desktop can draft these too, but read them carefully).
4. **You click submit.** Not Claude, not the script — you.

After you submit, go back to Claude Code and update the tracker:

> "I just applied to [Company] / [Role]. Update applications.md."

---

## Troubleshooting

### `command not found: node` (or claude, or git)

You installed the tool but your terminal can't find it. Solution: close and re-open the terminal app completely. If that doesn't work, restart your computer. If still broken, you may need to re-install with admin/sudo permissions.

### `npm install` fails with permission errors

On macOS/Linux, never run `npm install` with `sudo`. If it asks for permissions, your Node.js install is misconfigured — re-install Node.js from [nodejs.org](https://nodejs.org) using the official installer.

### `npx playwright install chromium` fails

You may be behind a corporate firewall. Try again on a different network. If still failing, you can skip this for now — PDF generation will be the only feature that doesn't work.

### Claude Code says "session limit exceeded" or "billing issue"

Claude Code needs an active Anthropic plan. Visit [anthropic.com/pricing](https://www.anthropic.com/pricing) and check that your plan supports Claude Code.

### `npm run doctor` shows red `✗` after I followed the steps

Run it again and read the exact message under the failing check. Each failure has a `→` hint that tells you the fix.

### I customized something and it broke

In Claude Code, just say "something is broken" or "doctor is failing on X, can you fix it?" — Claude Code can read the same code as you and will fix the issue.

### I want to undo a change

If you customized files and want to start over:
```bash
git status        # see what you changed
git diff <file>   # see how a file changed
git checkout <file>  # revert one file to its original state
```

---

## Getting help

- The project's [Discord](https://discord.gg/8pRpHETxa4) — community-run, helpful
- Inside Claude Code: just describe your problem in plain English. Claude Code can see the code, the error, and the file structure. It's good at debugging itself.

---

## What you should NOT do

- **Don't share your `.env` file** — it contains API keys.
- **Don't commit `cv.md` or `config/profile.yml` to a public git repo** — those are personal.
- **Don't let Claude Code submit applications automatically.** The system asks for your review before submitting anything, but if you start tweaking the prompts, this guardrail can be lost. Always click Submit yourself.
- **Don't mass-apply.** This tool is designed to help you target fewer, better applications — not flood employers with generic ones. A 4.0+ score is a signal to apply. Below 3.0, walk away.

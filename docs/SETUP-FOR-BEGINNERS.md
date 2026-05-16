# Setup Guide for Beginners

This is the slow-and-careful version of the setup. If you've never used a terminal, never run `npm`, and don't know what a git repo is — this guide is for you. You'll be running your first job evaluation in about 30 minutes.

If you're already comfortable with the terminal, see [SETUP.md](SETUP.md) instead.

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

This downloads the helper libraries the project uses. From inside `job-finder-ai`:

```bash
npm install
```

This takes 1–3 minutes. You'll see scrolling text — that's normal. When it stops and you get your prompt back, the install is done.

Now install the browser the PDF generator uses:

```bash
npx playwright install chromium
```

This is another 1–2 minute download.

---

## Part 4 — Run the health check

This script verifies every prerequisite is in place:

```bash
npm run doctor
```

You should see a list of checks with green `✓` marks. If anything is red `✗`, read the message — it will tell you exactly what to do.

**Expected output the first time:**

You will probably see warnings (yellow `!`) for things like "cv.md not customized" — that's expected, you haven't filled it in yet. As long as there are no red `✗` blockers, you're ready for the next step.

---

## Part 5 — First session with Claude Code

This is where the magic starts. From inside `job-finder-ai`, run:

```bash
claude
```

If this is your first time using Claude Code, it will open a browser window to log in. Sign in with your Anthropic account (the same one you use for claude.ai). You may need a paid plan to use Claude Code regularly — see [Anthropic's pricing](https://www.anthropic.com/pricing).

Once logged in, you'll be in Claude Code. **The first thing to type is:**

> Read CLAUDE.md and the README. I'm new — help me set up career-ops for myself.

Claude Code will do the rest:

1. Ask you to paste your resume (or your LinkedIn URL, or just describe your background)
2. Ask for your target roles, location, comp expectations
3. Fill in your `cv.md`, `config/profile.yml`, `modes/_profile.md`, and `portals.yml`
4. Confirm everything is set up

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

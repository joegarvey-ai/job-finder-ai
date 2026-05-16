#!/usr/bin/env node

/**
 * doctor.mjs — Setup validation for career-ops
 * Checks all prerequisites and prints a pass/fail checklist.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname;

// ANSI colors (only on TTY)
const isTTY = process.stdout.isTTY;
const green = (s) => isTTY ? `\x1b[32m${s}\x1b[0m` : s;
const red = (s) => isTTY ? `\x1b[31m${s}\x1b[0m` : s;
const dim = (s) => isTTY ? `\x1b[2m${s}\x1b[0m` : s;

function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0]);
  if (major >= 18) {
    return { pass: true, label: `Node.js >= 18 (v${process.versions.node})` };
  }
  return {
    pass: false,
    label: `Node.js >= 18 (found v${process.versions.node})`,
    fix: 'Install Node.js 18 or later from https://nodejs.org',
  };
}

function checkClaudeCode() {
  try {
    const out = execSync('claude --version', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).toString().trim();
    return { pass: true, label: `Claude Code CLI installed (${out})` };
  } catch {
    return {
      pass: false,
      label: 'Claude Code CLI not detected on PATH',
      fix: [
        'career-ops runs inside Claude Code. Install it from https://docs.claude.com/claude-code',
        'macOS / Linux: curl -fsSL https://claude.ai/install.sh | bash',
        'Windows: see install instructions at the URL above',
        'After install, restart your terminal and re-run `npm run doctor`',
      ],
      severity: 'warn',
    };
  }
}

function checkDependencies() {
  if (existsSync(join(projectRoot, 'node_modules'))) {
    return { pass: true, label: 'Dependencies installed' };
  }
  return {
    pass: false,
    label: 'Dependencies not installed',
    fix: 'Run: npm install',
  };
}

async function checkPlaywright() {
  try {
    const { chromium } = await import('playwright');
    const execPath = chromium.executablePath();
    if (existsSync(execPath)) {
      return { pass: true, label: 'Playwright chromium installed' };
    }
    return {
      pass: false,
      label: 'Playwright chromium not installed',
      fix: 'Run: npx playwright install chromium',
    };
  } catch {
    return {
      pass: false,
      label: 'Playwright chromium not installed',
      fix: 'Run: npx playwright install chromium',
    };
  }
}

function checkCv() {
  const cvPath = join(projectRoot, 'cv.md');
  const examplePath = join(projectRoot, 'cv.example.md');
  if (!existsSync(cvPath)) {
    return {
      pass: false,
      label: 'cv.md not found',
      fix: [
        'Create cv.md in the project root with your CV in markdown',
        'Easiest: open Claude Code in this folder and say "set up my cv"',
        'Or: copy cv.example.md to cv.md and edit it',
      ],
    };
  }
  if (existsSync(examplePath)) {
    try {
      const cv = readFileSync(cvPath, 'utf8');
      const example = readFileSync(examplePath, 'utf8');
      if (cv.trim() === example.trim()) {
        return {
          pass: false,
          label: 'cv.md is still the example (not customized)',
          fix: [
            'Edit cv.md to contain YOUR resume, not the example',
            'Or in Claude Code, say: "replace cv.md with my actual CV"',
          ],
          severity: 'warn',
        };
      }
    } catch {
      // Fall through to pass — file exists, can't compare
    }
  }
  return { pass: true, label: 'cv.md found' };
}

function checkProfile() {
  const profilePath = join(projectRoot, 'config', 'profile.yml');
  const examplePath = join(projectRoot, 'config', 'profile.example.yml');
  if (!existsSync(profilePath)) {
    return {
      pass: false,
      label: 'config/profile.yml not found',
      fix: [
        'Run: cp config/profile.example.yml config/profile.yml',
        'Then edit it with your details (name, email, target roles, comp range)',
        'Easiest: open Claude Code in this folder — it will run onboarding automatically',
      ],
    };
  }
  if (existsSync(examplePath)) {
    try {
      const profile = readFileSync(profilePath, 'utf8');
      const example = readFileSync(examplePath, 'utf8');
      if (profile.trim() === example.trim()) {
        return {
          pass: false,
          label: 'config/profile.yml is still the example (not customized)',
          fix: [
            'Edit config/profile.yml — replace placeholders with your name, email, and target roles',
            'Or in Claude Code, say: "set up my profile"',
          ],
          severity: 'warn',
        };
      }
    } catch {
      // Fall through
    }
  }
  return { pass: true, label: 'config/profile.yml found' };
}

function checkProfileMode() {
  const profileMode = join(projectRoot, 'modes', '_profile.md');
  const template = join(projectRoot, 'modes', '_profile.template.md');
  if (existsSync(profileMode)) {
    return { pass: true, label: 'modes/_profile.md found' };
  }
  if (existsSync(template)) {
    return {
      pass: false,
      label: 'modes/_profile.md not found',
      fix: [
        'Run: cp modes/_profile.template.md modes/_profile.md',
        'Or in Claude Code, say: "set up _profile.md" — Claude Code does this automatically on first session',
      ],
      severity: 'warn',
    };
  }
  return {
    pass: false,
    label: 'modes/_profile.md and modes/_profile.template.md both missing',
    fix: 'Re-clone the repository — _profile.template.md should ship with it',
  };
}

function checkPortals() {
  if (existsSync(join(projectRoot, 'portals.yml'))) {
    return { pass: true, label: 'portals.yml found' };
  }
  return {
    pass: false,
    label: 'portals.yml not found',
    fix: [
      'Run: cp templates/portals.example.yml portals.yml',
      'Then customize with your target companies',
    ],
  };
}

function checkFonts() {
  const fontsDir = join(projectRoot, 'fonts');
  if (!existsSync(fontsDir)) {
    return {
      pass: false,
      label: 'fonts/ directory not found',
      fix: 'The fonts/ directory is required for PDF generation',
    };
  }
  try {
    const files = readdirSync(fontsDir);
    if (files.length === 0) {
      return {
        pass: false,
        label: 'fonts/ directory is empty',
        fix: 'The fonts/ directory must contain font files for PDF generation',
      };
    }
  } catch {
    return {
      pass: false,
      label: 'fonts/ directory not readable',
      fix: 'Check permissions on the fonts/ directory',
    };
  }
  return { pass: true, label: 'Fonts directory ready' };
}

function checkAutoDir(name) {
  const dirPath = join(projectRoot, name);
  if (existsSync(dirPath)) {
    return { pass: true, label: `${name}/ directory ready` };
  }
  try {
    mkdirSync(dirPath, { recursive: true });
    return { pass: true, label: `${name}/ directory ready (auto-created)` };
  } catch {
    return {
      pass: false,
      label: `${name}/ directory could not be created`,
      fix: `Run: mkdir ${name}`,
    };
  }
}

const yellow = (s) => isTTY ? `\x1b[33m${s}\x1b[0m` : s;

async function main() {
  console.log('\ncareer-ops doctor');
  console.log('================\n');

  const checks = [
    checkNodeVersion(),
    checkClaudeCode(),
    checkDependencies(),
    await checkPlaywright(),
    checkCv(),
    checkProfile(),
    checkProfileMode(),
    checkPortals(),
    checkFonts(),
    checkAutoDir('data'),
    checkAutoDir('output'),
    checkAutoDir('reports'),
  ];

  let failures = 0;
  let warnings = 0;

  for (const result of checks) {
    if (result.pass) {
      console.log(`${green('✓')} ${result.label}`);
    } else if (result.severity === 'warn') {
      warnings++;
      console.log(`${yellow('!')} ${result.label}`);
      const fixes = Array.isArray(result.fix) ? result.fix : [result.fix];
      for (const hint of fixes) {
        console.log(`  ${dim('→ ' + hint)}`);
      }
    } else {
      failures++;
      console.log(`${red('✗')} ${result.label}`);
      const fixes = Array.isArray(result.fix) ? result.fix : [result.fix];
      for (const hint of fixes) {
        console.log(`  ${dim('→ ' + hint)}`);
      }
    }
  }

  console.log('');
  if (failures > 0) {
    console.log(`Result: ${failures} blocker${failures === 1 ? '' : 's'}${warnings ? ` and ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}. Fix the blockers and run \`npm run doctor\` again.`);
    process.exit(1);
  } else if (warnings > 0) {
    console.log(`Result: All blockers passed, ${warnings} warning${warnings === 1 ? '' : 's'}. You can start, but address the warnings for the best experience.`);
    console.log('');
    console.log('Start career-ops: run `claude` in this folder, then type `/career-ops`');
    console.log('');
    console.log('Join the community: https://discord.gg/8pRpHETxa4');
    process.exit(0);
  } else {
    console.log('Result: All checks passed. You\'re ready to go!');
    console.log('');
    console.log('Start career-ops: run `claude` in this folder, then type `/career-ops`');
    console.log('');
    console.log('Join the community: https://discord.gg/8pRpHETxa4');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('doctor.mjs failed:', err.message);
  process.exit(1);
});

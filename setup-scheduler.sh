#!/usr/bin/env bash
# setup-scheduler.sh — Deploy/repair the career-ops scan launchd job.
#
# Idempotent. Run after: fresh clone, bootstrap re-run, path move, or
# whenever the scheduled scan stops firing. Safe to run any time.
#
# What it does:
#   1. Sanity-checks scan-and-sync.sh and report-sync.sh exist
#   2. chmod +x them (gitignored files lose their bit on some clones)
#   3. Generates the launchd plist with absolute paths derived from this
#      script's location (so a `git mv` of the repo Just Works)
#   4. Prepends GNU grep to PATH if installed (silences `grep -P` noise
#      from headless `claude -p` runs)
#   5. Deploys to ~/Library/LaunchAgents/ and reloads launchctl
#
# NOTE: RunAtLoad=true in the plist, so reloading triggers one scan
# immediately. That's intentional (validates the deploy + catches up a
# missed window). If you want to skip the immediate fire, pass --no-fire.
#
# Customization:
#   LABEL — override the launchd label (default: com.career-ops.scan).
#           Run `LABEL=com.you.career-ops-scan ./setup-scheduler.sh` to deploy
#           under a custom identifier. If you previously deployed under a
#           different label, unload the old one to avoid duplicate scheduling:
#               launchctl unload ~/Library/LaunchAgents/OLD_LABEL.plist
#               rm ~/Library/LaunchAgents/OLD_LABEL.plist

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Override with `LABEL=com.you.career-ops-scan ./setup-scheduler.sh` if you want
# a different launchd identifier (e.g. to keep an existing job alongside this one,
# or to namespace by user). Defaults to a generic label that works for any fork.
PLIST_LABEL="${LABEL:-com.career-ops.scan}"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"
SCAN_SCRIPT="$PROJECT_DIR/scan-and-sync.sh"
REPORT_SCRIPT="$PROJECT_DIR/report-sync.sh"
GNU_GREP_BIN="/opt/homebrew/opt/grep/libexec/gnubin"

NO_FIRE=0
for arg in "$@"; do
  case "$arg" in
    --no-fire) NO_FIRE=1 ;;
    -h|--help)
      awk '/^#!/{next} /^[^#]/{exit} {sub(/^# ?/,""); print}' "$0"
      exit 0
      ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

[ "$(uname)" = "Darwin" ] || { echo "error: macOS only (uses launchd)" >&2; exit 2; }

for s in "$SCAN_SCRIPT" "$REPORT_SCRIPT"; do
  if [ ! -f "$s" ]; then
    echo "error: missing $s" >&2
    base="$(basename "$s" .sh)"
    if [ -f "$PROJECT_DIR/$base.example.sh" ]; then
      echo "       copy from $base.example.sh and edit CAREER_OPS_DIR" >&2
    fi
    exit 2
  fi
done

chmod +x "$SCAN_SCRIPT" "$REPORT_SCRIPT"

PATH_VALUE="$HOME/.npm-global/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
if [ -d "$GNU_GREP_BIN" ]; then
  PATH_VALUE="$GNU_GREP_BIN:$PATH_VALUE"
fi

mkdir -p "$(dirname "$PLIST_DEST")" "$PROJECT_DIR/data"

cat > "$PLIST_DEST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_LABEL</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>$SCAN_SCRIPT &amp;&amp; $REPORT_SCRIPT</string>
    </array>

    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$PATH_VALUE</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>

    <key>StandardOutPath</key>
    <string>$PROJECT_DIR/data/launchd-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>$PROJECT_DIR/data/launchd-stderr.log</string>

    <!-- Run every 3 days (259200 seconds) -->
    <key>StartInterval</key>
    <integer>259200</integer>

    <!-- Run on load so a missed window catches up -->
    <key>RunAtLoad</key>
    <$([ "$NO_FIRE" -eq 1 ] && echo false || echo true)/>
</dict>
</plist>
EOF

if launchctl list "$PLIST_LABEL" >/dev/null 2>&1; then
  launchctl unload "$PLIST_DEST" 2>/dev/null || true
fi
launchctl load "$PLIST_DEST"

echo "✓ scheduler deployed"
echo "  plist:       $PLIST_DEST"
echo "  project:     $PROJECT_DIR"
echo "  gnu grep:    $([ -d "$GNU_GREP_BIN" ] && echo "on PATH" || echo "MISSING — run 'brew install grep' to silence grep -P noise")"
echo "  fires on:    $([ "$NO_FIRE" -eq 1 ] && echo "schedule only (3-day interval)" || echo "load + every 3 days")"
echo
launchctl list "$PLIST_LABEL" | grep -E "PID|LastExitStatus" | sed 's/^/  /'
echo
echo "Watch progress: tail -f $PROJECT_DIR/data/scan-and-sync.log"

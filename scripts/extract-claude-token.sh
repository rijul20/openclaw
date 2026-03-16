#!/usr/bin/env bash
set -euo pipefail

# Extract the Claude Code OAuth token from the local credential store.
#
# macOS: reads from Keychain ("Claude Code-credentials")
# Linux/WSL: reads from ~/.claude/.credentials.json
#
# Outputs the bare token to stdout. Use in scripts:
#   TOKEN=$(bash scripts/extract-claude-token.sh)

if [[ "$(uname)" == "Darwin" ]]; then
  CRED_RAW=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null || echo "")
  if [ -z "$CRED_RAW" ]; then
    echo "ERROR: No Claude Code credentials in Keychain. Run 'claude' and sign in first." >&2
    exit 1
  fi
  TOKEN=$(echo "$CRED_RAW" | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      try{process.stdout.write(JSON.parse(d).claudeAiOauth?.accessToken||'')}catch{}
    })")
else
  CRED_FILE="$HOME/.claude/.credentials.json"
  if [ ! -f "$CRED_FILE" ]; then
    echo "ERROR: No credentials at $CRED_FILE. Run 'claude' and sign in first." >&2
    exit 1
  fi
  TOKEN=$(node -e "
    const fs=require('fs');
    try{const d=JSON.parse(fs.readFileSync('$CRED_FILE','utf-8'));
      process.stdout.write(d.claudeAiOauth?.accessToken||'')}catch{}")
fi

if [ -z "$TOKEN" ]; then
  echo "ERROR: OAuth token not found in credentials." >&2
  exit 1
fi

echo "$TOKEN"

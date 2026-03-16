#!/usr/bin/env bash
set -euo pipefail

# Claude Code → OpenClaw setup
#
# Extracts the OAuth token from your Claude Code installation and
# configures OpenClaw to use it as the Anthropic API key. No proxy,
# no extra services — just native Anthropic provider with your
# Claude Code subscription billing.
#
# Prerequisites: Node.js 22+, openclaw, claude (authenticated)
# Usage: bash setup.sh [--telegram-token BOT_TOKEN]

TELEGRAM_TOKEN=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --telegram-token) TELEGRAM_TOKEN="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo "=== Claude Code → OpenClaw Setup ==="

# --- Check prerequisites ---
echo ""
echo "[1/5] Checking prerequisites..."

if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js not found. Install Node.js 22+ first."
  exit 1
fi

if ! command -v openclaw &>/dev/null; then
  echo "ERROR: openclaw not found. Install with: npm install -g openclaw"
  exit 1
fi

if ! command -v claude &>/dev/null; then
  echo "ERROR: Claude Code not found. Install with: npm install -g @anthropic-ai/claude-code"
  exit 1
fi

echo "  Node.js $(node --version)"
echo "  OpenClaw $(openclaw --version 2>&1 | head -1)"
echo "  Claude Code $(claude --version 2>&1 | head -1)"

# --- Extract OAuth token ---
echo ""
echo "[2/5] Extracting Claude Code OAuth token..."

TOKEN=""
if [[ "$(uname)" == "Darwin" ]]; then
  # macOS: read from Keychain
  CRED_RAW=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null || echo "")
  if [ -n "$CRED_RAW" ]; then
    TOKEN=$(echo "$CRED_RAW" | node -e "
      let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
        try{process.stdout.write(JSON.parse(d).claudeAiOauth?.accessToken||'')}catch{}
      })")
  fi
else
  # Linux/WSL: read from plaintext credentials file
  CRED_FILE="$HOME/.claude/.credentials.json"
  if [ -f "$CRED_FILE" ]; then
    TOKEN=$(node -e "
      const fs=require('fs');
      try{const d=JSON.parse(fs.readFileSync('$CRED_FILE','utf-8'));
        process.stdout.write(d.claudeAiOauth?.accessToken||'')}catch{}")
  fi
fi

if [ -z "$TOKEN" ]; then
  echo "ERROR: Could not extract OAuth token."
  echo "Run 'claude' and sign in first, then re-run this script."
  exit 1
fi

echo "  Token found (${TOKEN:0:20}...)"

# --- Configure OpenClaw ---
echo ""
echo "[3/5] Configuring OpenClaw..."

if [ ! -f "$HOME/.openclaw/openclaw.json" ]; then
  openclaw setup --non-interactive --mode local --accept-risk 2>/dev/null || true
fi

openclaw config set gateway.mode local 2>/dev/null
echo "  Base config set"

# --- Set up Anthropic provider with OAuth token ---
echo ""
echo "[4/5] Configuring Anthropic provider..."

openclaw onboard --non-interactive --accept-risk --auth-choice apiKey --anthropic-api-key "$TOKEN" 2>/dev/null || {
  # Fallback: write config directly
  node -e "
    const fs = require('fs');
    const cfgPath = process.env.HOME + '/.openclaw/openclaw.json';
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    cfg.agents = cfg.agents || {};
    cfg.agents.defaults = cfg.agents.defaults || {};
    cfg.agents.defaults.model = 'anthropic/claude-sonnet-4-6';
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  "

  # Write auth profile
  AUTH_DIR="$HOME/.openclaw/agents/main/agent"
  mkdir -p "$AUTH_DIR"
  node -e "
    const fs = require('fs');
    const path = '$AUTH_DIR/auth-profiles.json';
    let auth = {};
    try { auth = JSON.parse(fs.readFileSync(path, 'utf-8')); } catch {}
    auth.profiles = auth.profiles || {};
    auth.profiles['anthropic:default'] = {
      type: 'api_key',
      provider: 'anthropic',
      key: '$TOKEN'
    };
    fs.writeFileSync(path, JSON.stringify(auth, null, 2) + '\n');
  "
}

echo "  Anthropic provider configured with Claude Code OAuth token"
echo "  Default model: anthropic/claude-sonnet-4-6"

# --- Configure Telegram (optional) ---
if [ -n "$TELEGRAM_TOKEN" ]; then
  echo ""
  echo "[5/5] Configuring Telegram..."
  openclaw config set plugins.entries.telegram.enabled true 2>/dev/null
  openclaw config set channels.telegram.botToken "$TELEGRAM_TOKEN" 2>/dev/null
  openclaw config set channels.telegram.allowFrom '["*"]' 2>/dev/null
  openclaw config set channels.telegram.dmPolicy open 2>/dev/null
  echo "  Telegram configured"
else
  echo ""
  echo "[5/5] Skipping Telegram (no --telegram-token provided)"
fi

# --- Done ---
echo ""
echo "=== Setup Complete ==="
echo ""
echo "Start the gateway:"
echo "  openclaw gateway run --bind loopback --port 18789 --force"
echo ""
echo "Quick test (no gateway needed):"
echo "  openclaw agent --local --message 'Hello' --session-id test"
echo ""
if [ -n "$TELEGRAM_TOKEN" ]; then
  echo "Telegram is configured — send a message to your bot after starting the gateway."
  echo ""
fi
echo "NOTE: The OAuth token expires (~10 days). If it stops working,"
echo "run 'claude' to refresh, then re-run this script."

#!/usr/bin/env bash
set -euo pipefail

# Claude Code Provider — automated setup for OpenClaw
# Prerequisites: Node.js 22+, openclaw (npm i -g openclaw), claude (npm i -g @anthropic-ai/claude-code)
# Usage: bash setup.sh [--telegram-token BOT_TOKEN]

TELEGRAM_TOKEN=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --telegram-token) TELEGRAM_TOKEN="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo "=== Claude Code Provider Setup ==="

# --- Verify prerequisites ---
echo ""
echo "[1/7] Checking prerequisites..."

if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js not found. Install Node.js 22+ first."
  exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "ERROR: Node.js 22+ required (found v$(node --version))"
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

# --- Verify Claude Code auth ---
echo ""
echo "[2/7] Verifying Claude Code authentication..."

if [[ "$(uname)" == "Darwin" ]]; then
  CRED_RAW=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null || echo "")
  if [ -z "$CRED_RAW" ]; then
    echo "ERROR: Claude Code OAuth token not found in Keychain."
    echo "Run 'claude' and sign in first, then re-run this script."
    exit 1
  fi
  TOKEN=$(echo "$CRED_RAW" | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      try{const t=JSON.parse(d).claudeAiOauth?.accessToken;process.stdout.write(t||'')}catch{}
    })")
  if [ -z "$TOKEN" ]; then
    echo "ERROR: Could not extract OAuth token from Keychain."
    exit 1
  fi
  echo "  OAuth token found (keychain)"
else
  echo "  WARNING: Non-macOS detected. Token extraction may need manual config."
  echo "  The proxy reads from macOS Keychain by default."
  echo "  Continuing anyway..."
fi

# --- Install plugin ---
echo ""
echo "[3/7] Installing plugin..."

OPENCLAW_BIN=$(which openclaw)
OPENCLAW_DIR=$(cd "$(dirname "$OPENCLAW_BIN")/../lib/node_modules/openclaw" 2>/dev/null && pwd)
if [ ! -d "$OPENCLAW_DIR" ]; then
  # Try npm root
  OPENCLAW_DIR="$(npm root -g)/openclaw"
fi
if [ ! -d "$OPENCLAW_DIR" ]; then
  echo "ERROR: Could not find openclaw installation directory."
  exit 1
fi

PLUGIN_DIR="$OPENCLAW_DIR/extensions/claude-code-provider"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$PLUGIN_DIR"
cp "$SCRIPT_DIR/index.ts" "$PLUGIN_DIR/"
cp "$SCRIPT_DIR/proxy.ts" "$PLUGIN_DIR/"
cp "$SCRIPT_DIR/package.json" "$PLUGIN_DIR/"
cp "$SCRIPT_DIR/openclaw.plugin.json" "$PLUGIN_DIR/"

cd "$PLUGIN_DIR" && npm install --omit=dev --quiet 2>&1
echo "  Plugin installed at $PLUGIN_DIR"

# --- Configure OpenClaw ---
echo ""
echo "[4/7] Configuring OpenClaw..."

# Initial setup if not already done
if [ ! -f "$HOME/.openclaw/openclaw.json" ]; then
  openclaw setup --non-interactive --mode local --accept-risk 2>/dev/null || true
fi

# Enable plugin
openclaw config set plugins.entries.claude-code-provider.enabled true 2>/dev/null

# Set gateway mode
openclaw config set gateway.mode local 2>/dev/null

# Set timeout for Claude Code subprocess startup
openclaw config set agents.defaults.timeoutSeconds 120 2>/dev/null

echo "  Config updated"

# --- Write provider + model config ---
echo ""
echo "[5/7] Registering provider and models..."

CONFIG_FILE="$HOME/.openclaw/openclaw.json"

# Use node to merge the provider config (avoids issues with openclaw config set for nested objects)
node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf-8'));

// Set default model
cfg.agents = cfg.agents || {};
cfg.agents.defaults = cfg.agents.defaults || {};
cfg.agents.defaults.model = 'claude-code/claude-sonnet-4-6';

// Register provider
cfg.models = cfg.models || {};
cfg.models.providers = cfg.models.providers || {};
cfg.models.providers['claude-code'] = {
  baseUrl: 'http://127.0.0.1:18990',
  apiKey: 'claude-code-local',
  api: 'anthropic-messages',
  models: [
    {
      id: 'claude-sonnet-4-6',
      name: 'Claude Sonnet 4.6 (Claude Code)',
      api: 'anthropic-messages',
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 16384
    },
    {
      id: 'claude-opus-4-6',
      name: 'Claude Opus 4.6 (Claude Code)',
      api: 'anthropic-messages',
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 16384
    },
    {
      id: 'claude-haiku-4-5-20251001',
      name: 'Claude Haiku 4.5 (Claude Code)',
      api: 'anthropic-messages',
      reasoning: false,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 8192
    }
  ]
};

fs.writeFileSync('$CONFIG_FILE', JSON.stringify(cfg, null, 2) + '\n');
"
echo "  Provider registered: claude-code (3 models)"
echo "  Default model: claude-code/claude-sonnet-4-6"

# --- Write auth profile ---
echo ""
echo "[6/7] Writing auth profile..."

AUTH_DIR="$HOME/.openclaw/agents/main/agent"
mkdir -p "$AUTH_DIR"

# Merge into existing auth-profiles.json if it exists
node -e "
const fs = require('fs');
const path = '$AUTH_DIR/auth-profiles.json';
let auth = {};
try { auth = JSON.parse(fs.readFileSync(path, 'utf-8')); } catch {}
auth.profiles = auth.profiles || {};
auth.profiles['claude-code:default'] = {
  type: 'api_key',
  provider: 'claude-code',
  key: 'claude-code-local'
};
fs.writeFileSync(path, JSON.stringify(auth, null, 2) + '\n');
"
echo "  Auth profile written"

# --- Configure Telegram (optional) ---
if [ -n "$TELEGRAM_TOKEN" ]; then
  echo ""
  echo "[7/7] Configuring Telegram..."
  openclaw config set plugins.entries.telegram.enabled true 2>/dev/null
  openclaw config set channels.telegram.botToken "$TELEGRAM_TOKEN" 2>/dev/null
  openclaw config set channels.telegram.allowFrom '["*"]' 2>/dev/null
  openclaw config set channels.telegram.dmPolicy open 2>/dev/null
  echo "  Telegram configured"
else
  echo ""
  echo "[7/7] Skipping Telegram (no --telegram-token provided)"
fi

# --- Done ---
echo ""
echo "=== Setup Complete ==="
echo ""
echo "To start:"
echo ""
echo "  # Terminal 1: Start the proxy"
echo "  cd $PLUGIN_DIR && node --input-type=module -e '"
echo "    import { startProxy } from \"./proxy.ts\";'
echo '    await startProxy();'
echo '    await new Promise(() => {});'
echo "  '"
echo ""
echo "  # Terminal 2: Start the gateway"
echo "  openclaw gateway run --bind loopback --port 18789 --force"
echo ""
echo "  # Quick test (no gateway needed, just proxy):"
echo "  openclaw agent --local --message 'Hello' --session-id test"
echo ""
if [ -n "$TELEGRAM_TOKEN" ]; then
  echo "  Telegram bot is configured. Send a message to your bot after starting the gateway."
  echo ""
fi
echo "  Models available:"
echo "    claude-code/claude-sonnet-4-6  (default)"
echo "    claude-code/claude-opus-4-6"
echo "    claude-code/claude-haiku-4-5-20251001"

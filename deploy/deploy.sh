#!/usr/bin/env bash
# Build locally and ship the result. Nothing is compiled on the server.
#
# Configure by copying deploy/local.conf.example to deploy/local.conf —
# that file is gitignored, because it holds the server address and this
# repo is public.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONF="$ROOT/deploy/local.conf"

if [ ! -f "$CONF" ]; then
  echo "error: $CONF not found." >&2
  echo "Copy deploy/local.conf.example to deploy/local.conf and fill it in." >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$CONF"

: "${SSH_HOST:?set SSH_HOST in deploy/local.conf}"
: "${REMOTE_DIR:?set REMOTE_DIR in deploy/local.conf}"
: "${SITE_URL:?set SITE_URL in deploy/local.conf}"

echo "→ building (SITE_URL=$SITE_URL)"
cd "$ROOT"
SITE_URL="$SITE_URL" npm run build

echo "→ syncing to $SSH_HOST:$REMOTE_DIR"
# --delete so renamed or removed articles do not linger on the server.
rsync -az --delete --human-readable \
  "$ROOT/dist/" "$SSH_HOST:$REMOTE_DIR/"

echo "✓ deployed"

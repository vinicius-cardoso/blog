#!/usr/bin/env bash
# Sync articles written in the admin back into this repo, so the writing is
# versioned in git rather than living only on a free-tier VM.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONF="$ROOT/deploy/local.conf"
[ -f "$CONF" ] || { echo "error: deploy/local.conf not found" >&2; exit 1; }
# shellcheck source=/dev/null
source "$CONF"

: "${SSH_HOST:?}"
: "${REMOTE_CONTENT:=/var/www/blog-content}"

echo "→ pulling content from $SSH_HOST"
# No --delete here: deleting an article is a deliberate act, done in git.
rsync -az --human-readable \
  "$SSH_HOST:$REMOTE_CONTENT/" "$ROOT/src/content/"

echo "✓ pulled — review with: git status && git diff"

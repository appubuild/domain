#!/usr/bin/env bash
# One command to bring the Scriptora preview back up after a sandbox restart.
# node_modules is excluded from workspace snapshots, so it is reinstalled when missing.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -x node_modules/.bin/vite ]; then
  echo "==> vite missing — installing dependencies (npm ci)…"
  npm ci --no-audit --no-fund
fi

echo "==> starting Scriptora dev server on 0.0.0.0:5173"
exec npm run dev

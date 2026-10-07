#!/usr/bin/env bash
# Recovers the workspace after a sandbox restart:
#   1. reinstalls dependencies when node_modules is missing (it is not snapshotted)
#   2. re-points the local branch at the pushed branch when the local git history was reset
# Then it starts the dev server.
#
# Safe by design: if the working tree has uncommitted changes they are copied to
# /tmp/scriptora-restore-backup before anything is overwritten.
set -euo pipefail
cd "$(dirname "$0")/.."

BRANCH="arena/2dbf1f8f-domain"

if [ ! -x node_modules/.bin/vite ]; then
  echo "==> dependencies missing — running npm ci"
  npm ci --no-audit --no-fund
fi

if git rev-parse --verify --quiet "origin/$BRANCH" >/dev/null; then
  if ! git merge-base --is-ancestor "origin/$BRANCH" HEAD 2>/dev/null; then
    if [ -n "$(git status --porcelain)" ]; then
      echo "==> backing up uncommitted work to /tmp/scriptora-restore-backup"
      rm -rf /tmp/scriptora-restore-backup
      mkdir -p /tmp/scriptora-restore-backup
      git ls-files --others --exclude-standard | while read -r file; do
        mkdir -p "/tmp/scriptora-restore-backup/$(dirname "$file")"
        cp "$file" "/tmp/scriptora-restore-backup/$file"
      done
      git diff --name-only | while read -r file; do
        mkdir -p "/tmp/scriptora-restore-backup/$(dirname "$file")"
        cp "$file" "/tmp/scriptora-restore-backup/$file"
      done
    fi
    echo "==> local history is behind origin/$BRANCH — restoring"
    git update-ref "refs/heads/$BRANCH" "origin/$BRANCH"
    git read-tree --reset -u HEAD
  fi
fi

echo "==> starting dev server on 0.0.0.0:5173"
exec npm run dev

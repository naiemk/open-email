#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f package.json ]]; then
  echo "[devcontainer] Installing npm dependencies..."
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
else
  echo "[devcontainer] No package.json yet; skipping npm install."
fi

echo "[devcontainer] Installing mattpocock/skills (all agents)..."
npx --yes skills@latest add mattpocock/skills --all

echo "[devcontainer] Ready. Run /setup-matt-pocock-skills once per clone if docs/agents is missing."

#!/usr/bin/env bash
# Build shared packages and launch the CAD + Vector Studio Vite Viewer with
# checkout Python. Hot reload applies to apps/web; the embedded Codex plugin is
# a separate snapshot loop (see docs/codex-development.md).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ -x "$ROOT/.venv/bin/python" ]]; then
  VIEWER_PYTHON="${VIEWER_PYTHON:-$ROOT/.venv/bin/python}"
else
  VIEWER_PYTHON="${VIEWER_PYTHON:-python3}"
fi
export VIEWER_PYTHON

npm run build:packages

# Resolve project directory relative to the repository so launching from outside
# the checkout still opens a stable models/ (or ROOT) folder.
PROJECT_DIR="${VECTOR_STUDIO_PROJECT_DIR:-$ROOT/models}"
if [[ ! -d "$PROJECT_DIR" ]]; then
  PROJECT_DIR="$ROOT"
fi
cd "$PROJECT_DIR"

exec npm --prefix "$ROOT/apps/web" run dev -- --host 127.0.0.1

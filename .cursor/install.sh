#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for text-to-cad. Run from the repository root.
set -eu
if [ -d /agent/repos/text-to-cad ]; then
  cd /agent/repos/text-to-cad
elif [ ! -f requirements-dev.txt ] && [ -f /workspace/requirements-dev.txt ]; then
  cd /workspace
fi
if [ ! -f requirements-dev.txt ]; then
  echo "text-to-cad checkout not found" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
sudo apt-get update
sudo apt-get install -y --no-install-recommends xvfb libgl1-mesa-dri fonts-dejavu-core ca-certificates curl

if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
if [ -x "${HOME}/.local/bin/uv" ]; then
  sudo ln -sfn "${HOME}/.local/bin/uv" /usr/local/bin/uv
  sudo ln -sfn "${HOME}/.local/bin/uvx" /usr/local/bin/uvx
fi
hash -r

# Install the base interpreter, then point python3.14 at that binary.
# uv python find from this repo returns the project venv, and linking
# python3.14 there breaks the next clean checkout.
uv python install 3.14
base="$(readlink -f "${HOME}/.local/bin/python3.14")"
sudo ln -sfn "${base}" /usr/local/bin/python3.14

if ! ./.venv/bin/python -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 14) else 1)' >/dev/null 2>&1; then
  rm -rf .venv
  /usr/local/bin/python3.14 -m venv .venv
fi

uv pip install --python .venv/bin/python -r requirements-dev.txt
sudo ln -sfn "${PWD}/.venv/bin/python" /usr/local/bin/python

version="$(cat VERSION)"
CAD_INSTALLATION_VERSION="${version}-dev.0" ./.venv/bin/cad doctor --no-server

./.venv/bin/python -m playwright install --with-deps --only-shell chromium

command -v npm >/dev/null
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'

npm ci
npm run build:packages
npm run build -w @cad/web

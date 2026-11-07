#!/usr/bin/env python3
"""Change-aware refresh of the Codex development plugin.

Fingerprints only inputs consumed by the Codex plugin/app, stores a stamp under
ignored tmp/codex-dev, skips unchanged builds, and delegates installation to
scripts/install/dev_install.py. No automatic watcher — embedded MCP sessions and
mounted frames cannot hot-swap (see docs/codex-development.md).

Usage:
  scripts/dev/refresh_codex_plugin.py --check
  scripts/dev/refresh_codex_plugin.py
  scripts/dev/refresh_codex_plugin.py --force
  scripts/dev/refresh_codex_plugin.py --restart
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

REPO_ROOT = Path(__file__).resolve().parents[2]
STAMP_DIR = REPO_ROOT / "tmp" / "codex-dev"
STAMP_PATH = STAMP_DIR / "plugin-fingerprint.json"

# Paths / globs whose contents affect the embedded Codex plugin or its page.
# Package README / prose is excluded (not an embedded build input). Generated
# packaged runtime under cad_server/_runtime is excluded (built, never source).
INCLUDE_PREFIXES = (
    "apps/mcp/",
    "packages/core/src/",
    "packages/core/package.json",
    "packages/core/tsconfig",
    "packages/core/vite",
    "packages/ui/src/",
    "packages/ui/package.json",
    "packages/ui/tsconfig",
    "packages/ui/vite",
    "packages/cad/src/",
    "packages/cad/pyproject.toml",
    "packages/cad-server/src/",
    "packages/cad-server/pyproject.toml",
    "packages/cad-mcp/src/",
    "packages/cad-mcp/pyproject.toml",
    "skills/",
    ".codex-plugin/",
    "plugin.json",
    "mcp.json",
    "scripts/install/dev_install.py",
    "scripts/bundle/",
    "scripts/dev/refresh_codex_plugin.py",
    "package.json",
    "package-lock.json",
)

EXCLUDE_PARTS = (
    "/node_modules/",
    "/dist/",
    "/_runtime/",
    "/.venv/",
    "/tmp/",
    "README.md",
)


def _is_excluded(rel: str) -> bool:
    normalized = "/" + rel.replace("\\", "/")
    if any(part in normalized for part in EXCLUDE_PARTS):
        # Keep skill SKILL.md and other skill prose — only package README prose is noise.
        if rel.startswith("skills/") and rel.endswith("SKILL.md"):
            return False
        if rel.endswith("README.md") or "/_runtime/" in normalized or "/dist/" in normalized:
            return True
        if "/node_modules/" in normalized or "/.venv/" in normalized or "/tmp/" in normalized:
            return True
    return False


def _matches_include(rel: str) -> bool:
    return any(rel == prefix.rstrip("/") or rel.startswith(prefix) for prefix in INCLUDE_PREFIXES)


def iter_fingerprint_files(root: Path = REPO_ROOT) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        if _is_excluded(rel):
            continue
        if _matches_include(rel):
            files.append(path)
    return sorted(files)


def compute_fingerprint(root: Path = REPO_ROOT) -> dict:
    digest = hashlib.sha256()
    entries: list[dict] = []
    for path in iter_fingerprint_files(root):
        rel = path.relative_to(root).as_posix()
        data = path.read_bytes()
        file_hash = hashlib.sha256(data).hexdigest()
        digest.update(rel.encode())
        digest.update(b"\0")
        digest.update(file_hash.encode())
        entries.append({"path": rel, "sha256": file_hash})
    return {"sha256": digest.hexdigest(), "files": entries}


def load_stamp() -> dict | None:
    if not STAMP_PATH.is_file():
        return None
    try:
        return json.loads(STAMP_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def write_stamp(payload: dict) -> None:
    STAMP_DIR.mkdir(parents=True, exist_ok=True)
    STAMP_PATH.write_text(json.dumps(payload, indent=2) + "\n")


def needs_refresh(current: dict) -> bool:
    previous = load_stamp()
    if previous is None:
        return True
    return previous.get("sha256") != current.get("sha256")


def run_install(*, restart: bool) -> int:
    cmd = [sys.executable, str(REPO_ROOT / "scripts/install/dev_install.py"), "codex"]
    if restart:
        cmd.append("--restart")
    env = os.environ.copy()
    return subprocess.call(cmd, cwd=str(REPO_ROOT), env=env)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="report whether a refresh is needed; exit 1 if needed")
    parser.add_argument("--force", action="store_true", help="rebuild/reinstall even when fingerprint matches")
    parser.add_argument("--restart", action="store_true", help="pass --restart to dev_install.py after install")
    args = parser.parse_args(argv)

    current = compute_fingerprint()
    stale = needs_refresh(current)

    if args.check:
        if stale:
            print("refresh-needed")
            return 1
        print("up-to-date")
        return 0

    if not stale and not args.force:
        print("up-to-date")
        return 0

    status = run_install(restart=args.restart)
    if status != 0:
        return status
    write_stamp({"sha256": current["sha256"]})
    print("refreshed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Contracts for the Codex two-loop development workflow helpers.

Covers fingerprint selection / refresh decisions, the Vite launcher command
shape, and the canonical guide naming both loops without an automatic watcher.
"""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import textwrap
import unittest

from tests.python.support.paths import REPO_ROOT

REFRESH = REPO_ROOT / "scripts/dev/refresh_codex_plugin.py"
LAUNCHER = REPO_ROOT / "scripts/dev/vector-studio.sh"
GUIDE = REPO_ROOT / "docs/codex-development.md"


def _load_refresh():
    spec = importlib.util.spec_from_file_location("refresh_codex_plugin", REFRESH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CodexDevWorkflowTests(unittest.TestCase):
    def test_guide_states_both_loops_and_no_watcher(self):
        text = GUIDE.read_text(encoding="utf-8")
        self.assertIn("hot reload", text.lower())
        self.assertIn("snapshot", text.lower())
        self.assertIn("vector-studio.sh", text)
        self.assertIn("refresh_codex_plugin.py", text)
        self.assertIn("no automatic watcher", text.lower())
        self.assertIn("managed cloud", text.lower())
        self.assertIn("fresh", text.lower())

    def test_launcher_is_executable_and_names_vite_host(self):
        self.assertTrue(LAUNCHER.is_file())
        mode = LAUNCHER.stat().st_mode
        self.assertTrue(mode & stat.S_IXUSR)
        body = LAUNCHER.read_text(encoding="utf-8")
        self.assertIn("build:packages", body)
        self.assertIn("127.0.0.1", body)
        self.assertIn("VIEWER_PYTHON", body)

    def test_fingerprint_includes_plugin_inputs_excludes_runtime_and_package_readme(self):
        refresh = _load_refresh()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "apps/mcp/src").mkdir(parents=True)
            (root / "apps/mcp/src/App.tsx").write_text("export default 1\n", encoding="utf-8")
            (root / "packages/ui/src").mkdir(parents=True)
            (root / "packages/ui/src/index.ts").write_text("export {}\n", encoding="utf-8")
            (root / "packages/ui/README.md").write_text("# ui\n", encoding="utf-8")
            (root / "packages/cad-server/src/cad_server/_runtime/viewer").mkdir(parents=True)
            (root / "packages/cad-server/src/cad_server/_runtime/viewer/index.html").write_text(
                "<html></html>\n", encoding="utf-8"
            )
            (root / "scripts/bundle").mkdir(parents=True)
            (root / "scripts/bundle/bundle.sh").write_text("#!/bin/sh\n", encoding="utf-8")
            (root / "skills/cad").mkdir(parents=True)
            (root / "skills/cad/SKILL.md").write_text("---\nname: cad\n---\n", encoding="utf-8")
            (root / "scripts/install").mkdir(parents=True)
            (root / "scripts/install/dev_install.py").write_text("print('ok')\n", encoding="utf-8")
            (root / "package.json").write_text("{}\n", encoding="utf-8")

            files = {p.relative_to(root).as_posix() for p in refresh.iter_fingerprint_files(root)}
            self.assertIn("apps/mcp/src/App.tsx", files)
            self.assertIn("packages/ui/src/index.ts", files)
            self.assertIn("scripts/bundle/bundle.sh", files)
            self.assertIn("skills/cad/SKILL.md", files)
            self.assertNotIn("packages/ui/README.md", files)
            self.assertTrue(all("_runtime" not in path for path in files))

    def test_unchanged_fingerprint_is_up_to_date(self):
        refresh = _load_refresh()
        current = refresh.compute_fingerprint()
        previous_stamp = refresh.STAMP_PATH
        previous_dir = refresh.STAMP_DIR
        with tempfile.TemporaryDirectory() as tmp:
            stamp_dir = Path(tmp) / "codex-dev"
            stamp_path = stamp_dir / "plugin-fingerprint.json"
            refresh.STAMP_DIR = stamp_dir
            refresh.STAMP_PATH = stamp_path
            try:
                refresh.write_stamp({"sha256": current["sha256"]})
                self.assertFalse(refresh.needs_refresh(current))
                self.assertEqual(refresh.main(["--check"]), 0)
            finally:
                refresh.STAMP_DIR = previous_dir
                refresh.STAMP_PATH = previous_stamp

    def test_launcher_records_build_and_dev_from_project_dir(self):
        """Self-contained: fake npm records argv/cwd without needing checkout .venv."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "checkout"
            (root / "scripts/dev").mkdir(parents=True)
            (root / "apps/web").mkdir(parents=True)
            (root / "models").mkdir(parents=True)
            (root / "package.json").write_text("{}\n", encoding="utf-8")
            launcher = root / "scripts/dev/vector-studio.sh"
            launcher.write_text(LAUNCHER.read_text(encoding="utf-8"), encoding="utf-8")
            launcher.chmod(launcher.stat().st_mode | stat.S_IXUSR)

            bin_dir = Path(tmp) / "bin"
            bin_dir.mkdir()
            log = Path(tmp) / "npm.log"
            fake_npm = bin_dir / "npm"
            fake_npm.write_text(
                textwrap.dedent(
                    f"""\
                    #!/usr/bin/env bash
                    printf '%s\\n' "PWD=$PWD" "ARGS=$*" >> {log}
                    if [[ "$*" == *run\\ build:packages* ]]; then exit 0; fi
                    if [[ "$*" == *run\\ dev* ]]; then exit 0; fi
                    exit 0
                    """
                ),
                encoding="utf-8",
            )
            fake_npm.chmod(fake_npm.stat().st_mode | stat.S_IXUSR)

            env = os.environ.copy()
            env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
            env["VIEWER_PYTHON"] = sys.executable
            # Script resolves ROOT from its own path; run it from outside the checkout.
            outside = Path(tmp) / "outside"
            outside.mkdir()
            result = subprocess.run(
                [str(launcher)],
                cwd=str(outside),
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            recorded = log.read_text(encoding="utf-8")
            self.assertIn("run build:packages", recorded)
            self.assertIn("run dev", recorded)
            self.assertIn("--host 127.0.0.1", recorded)
            self.assertIn(f"PWD={root / 'models'}", recorded)


if __name__ == "__main__":
    unittest.main()

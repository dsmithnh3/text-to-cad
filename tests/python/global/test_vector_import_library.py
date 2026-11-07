"""Bounded ZIP ingestion for the local Vector SVG library importer."""
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
import zipfile
import zlib
from pathlib import Path

from tests.python.support.paths import REPO_ROOT

IMPORTER = REPO_ROOT / "scripts/vector/import_svg_library.py"


def _load_importer():
    spec = importlib.util.spec_from_file_location("import_svg_library", IMPORTER)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def _svg(name: str = "ok") -> bytes:
    return f'<svg xmlns="http://www.w3.org/2000/svg"><title>{name}</title></svg>'.encode()


def _write_zip(path: Path, members: dict[str, bytes]) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in members.items():
            archive.writestr(name, data)


def _run_main(importer, zip_path: Path, *, target: Path) -> int:
    original_target = importer.TARGET
    importer.TARGET = target
    argv = sys.argv
    sys.argv = ["import_svg_library.py", str(zip_path)]
    try:
        return int(importer.main())
    finally:
        sys.argv = argv
        importer.TARGET = original_target


class VectorImportLibraryTests(unittest.TestCase):
    def test_rejects_irrelevant_member_without_decompressing_payload(self):
        """A huge non-SVG compressed member must not be fully inflated."""
        importer = _load_importer()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            zip_path = root / "lib.zip"
            huge = b"X" * 5_000_000
            with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                info = zipfile.ZipInfo("junk/noise.bin")
                info.compress_type = zipfile.ZIP_DEFLATED
                # Keep zlib import used so the fixture stays explicitly compressible.
                self.assertGreater(len(huge), len(zlib.compress(huge)))
                archive.writestr(info, huge)
                archive.writestr("components/part.svg", _svg("part"))

            opened_names: list[str] = []
            original_open = zipfile.ZipFile.open

            def tracking_open(self, name, *args, **kwargs):  # noqa: ANN001
                opened_names.append(getattr(name, "filename", str(name)))
                return original_open(self, name, *args, **kwargs)

            zipfile.ZipFile.open = tracking_open  # type: ignore[method-assign]
            try:
                code = _run_main(importer, zip_path, target=root / "assets")
            finally:
                zipfile.ZipFile.open = original_open  # type: ignore[method-assign]

            self.assertEqual(code, 0)
            self.assertTrue(opened_names, opened_names)
            self.assertTrue(all(name.lower().endswith(".svg") for name in opened_names), opened_names)
            self.assertFalse(any(name.endswith(".bin") for name in opened_names), opened_names)

    def test_oversized_selected_svg_fails_from_central_directory(self):
        importer = _load_importer()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            zip_path = root / "big.svg.zip"
            oversized = b"<svg xmlns='http://www.w3.org/2000/svg'>" + (b"a" * (importer.MAX_FILE + 1)) + b"</svg>"
            _write_zip(zip_path, {"components/too-big.svg": oversized})
            with self.assertRaises(SystemExit) as raised:
                _run_main(importer, zip_path, target=root / "assets")
            self.assertIn("central-directory", str(raised.exception).lower())
            written = list((root / "assets").rglob("*.svg")) if (root / "assets").exists() else []
            self.assertEqual(written, [])

    def test_no_testzip_full_walk(self):
        source = IMPORTER.read_text(encoding="utf-8")
        self.assertNotIn("testzip(", source)
        self.assertIn("infolist(", source)


if __name__ == "__main__":
    unittest.main()

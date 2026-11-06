#!/usr/bin/env python3
"""Import a locally held SupaCAD-derived SVG component archive into the fork's
native Vector Studio. Source assets are not committed or redistributed.

Usage:
  python3 scripts/vector/import_svg_library.py ~/Downloads/SupaCAD_Modular_SVG_Components_Library.zip
  npm run build:web

Runs offline, extracts SVGs only, preserves source bytes and emits provenance.
"""
from __future__ import annotations
import argparse, csv, hashlib, json, pathlib, re, sys, zipfile
from xml.etree import ElementTree

ROOT = pathlib.Path(__file__).resolve().parents[2]
TARGET = ROOT / "apps/web/src/vector/assets"
MAX_FILES = 2000
MAX_FILE = 2_000_000
MAX_TOTAL = 80_000_000

def safe_text(x: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]+", "-", x).strip("-")[:120]

def validate_svg(blob: bytes) -> bool:
    if len(blob) > MAX_FILE: return False
    try:
        root = ElementTree.fromstring(blob)
        return root.tag.rsplit("}", 1)[-1].lower() == "svg"
    except ElementTree.ParseError:
        return False

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zip_file", type=pathlib.Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not args.zip_file.is_file():
        parser.error("ZIP file not found")
    if not args.dry_run: TARGET.mkdir(parents=True, exist_ok=True)
    manifest, rejected, total = [], [], 0
    with zipfile.ZipFile(args.zip_file) as archive:
        broken = archive.testzip()
        if broken: raise SystemExit("Corrupted ZIP member: " + broken)
        files = [info for info in archive.infolist() if not info.is_dir() and info.filename.lower().endswith(".svg")]
        if len(files) > MAX_FILES: raise SystemExit(f"Too many SVGs: {len(files)}")
        for info in files:
            src = pathlib.PurePosixPath(info.filename)
            if ".." in src.parts or info.file_size > MAX_FILE or not any(part in {"components", "icons"} for part in src.parts):
                rejected.append(info.filename); continue
            total += info.file_size
            if total > MAX_TOTAL: raise SystemExit("Archive exceeds 80 MB SVG budget")
            data = archive.read(info)
            if not validate_svg(data): rejected.append(info.filename); continue
            cat = src.parts[-2] if len(src.parts) > 1 else "misc"
            name = safe_text(src.stem)
            hashpart = hashlib.sha256(data).hexdigest()[:10]
            outname = f"{name}-{hashpart}.svg"
            rel = pathlib.Path(safe_text(cat)) / outname
            if not args.dry_run:
                dest = TARGET / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(data)
            manifest.append({"source":info.filename, "path":str(rel), "sha256":hashlib.sha256(data).hexdigest(), "bytes":len(data), "category":cat})
    if not args.dry_run:
        (TARGET / "_import_manifest.json").write_text(json.dumps({"source": args.zip_file.name, "assets": manifest, "rejected": rejected}, indent=2))
        gitignore = TARGET / ".gitignore"
        gitignore.write_text("*.svg\n_import_manifest.json\n")
    print(f"Imported {len(manifest)} vector files; rejected {len(rejected)}; destination {TARGET}")
    if rejected: print("Rejected sample:", rejected[:6])
    return 0

if __name__ == "__main__":
    sys.exit(main())

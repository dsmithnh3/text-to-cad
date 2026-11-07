"""Immutable CAD-accurate projection asset revisions.

Each successful orthographic or isometric export publishes a new revision id.
Prior revisions are never rewritten; regeneration reads provenance and publishes
another revision on the same asset lineage when ``expectedRevision`` matches tip.
"""

from __future__ import annotations

import json
import threading
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

from cad._internal.atomic_replace import write_bytes_atomic
from cad.cad_projection import (
    CadProjectionError,
    CadProjectionExport,
    parse_projection_provenance,
    project_file_to_svg,
)
from cad.engine.ids import is_id
from cad.engine.places import state_dir
from cad.vector_project import MAX_AGGREGATE_SVG_BYTES, MAX_PROJECT_BYTES
from cad_server._internal.file_lock import state

__all__ = [
    "DOCUMENT",
    "FOLDER",
    "MAX_BODY_BYTES",
    "DocumentPathResolver",
    "VectorProjectionImmutable",
    "VectorProjectionInvalid",
    "VectorProjectionNotFound",
    "VectorProjectionStaleRevision",
    "VectorProjectionStore",
    "VectorProjectionStoreError",
    "export_document_projection",
    "export_file_projection",
    "reproject_from_provenance",
]

DocumentPathResolver = Callable[[str], str | Path]

FOLDER = "vector-projections"
DOCUMENT = "revision.json"
MAX_BODY_BYTES = MAX_PROJECT_BYTES + 4096


class VectorProjectionStoreError(ValueError):
    """Base error for CAD projection asset revisions."""


class VectorProjectionInvalid(VectorProjectionStoreError):
    """Export payload failed shape or provenance validation before write."""


class VectorProjectionNotFound(VectorProjectionStoreError):
    """No published revision for the given revision id."""


class VectorProjectionImmutable(VectorProjectionStoreError):
    """A published revision cannot be overwritten."""


class VectorProjectionStaleRevision(VectorProjectionStoreError):
    """Regeneration expected a lineage tip that is no longer current."""

    def __init__(self, *, expected: int, current: int) -> None:
        super().__init__(f"expected revision {expected}, current is {current}")
        self.expected = expected
        self.current = current


def _require_name(name: Any) -> str:
    if not isinstance(name, str) or not name:
        raise VectorProjectionInvalid("asset.name must be a non-empty string")
    return name


def _validate_publish_payload(payload: Any) -> tuple[dict[str, Any], dict[str, Any], str]:
    """Return (asset without id, projection provenance, name)."""
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError as error:
            raise VectorProjectionInvalid("projection publish must be a JSON object") from error
    if not isinstance(payload, dict):
        raise VectorProjectionInvalid("projection publish must be a JSON object")
    name = _require_name(payload.get("name"))
    svg = payload.get("svg")
    if not isinstance(svg, str):
        raise VectorProjectionInvalid("svg must be a string")
    if len(svg.encode("utf-8")) > MAX_AGGREGATE_SVG_BYTES:
        raise VectorProjectionInvalid(
            f"svg exceeds MAX_AGGREGATE_SVG_BYTES ({MAX_AGGREGATE_SVG_BYTES})",
        )
    try:
        projection = parse_projection_provenance(payload.get("projection"))
    except CadProjectionError as error:
        raise VectorProjectionInvalid(str(error)) from error
    allowed = {"name", "svg", "projection", "assetId"}
    if not set(payload) <= allowed:
        raise VectorProjectionInvalid("projection publish has unknown fields")
    asset = {
        "name": name,
        "category": "CAD projection",
        "svg": svg,
        "provenance": "source-derived",
    }
    return asset, projection, name


class VectorProjectionStore:
    """File-backed immutable projection assets under ``<state>/vector-projections/``."""

    def __init__(
        self,
        root: Path | None = None,
        *,
        resolve_document_path: DocumentPathResolver | None = None,
    ) -> None:
        self.root = Path(root) if root is not None else state_dir() / FOLDER
        self._lock = threading.Lock()
        self.resolve_document_path = resolve_document_path

    def publish(
        self,
        payload: Any,
        *,
        asset_id: str | None = None,
    ) -> dict[str, Any]:
        """Validate then publish a new immutable projection revision.

        Passing ``asset_id`` advances that lineage's revision counter; omitting it
        starts a new asset at revision 1. Prior revisions are never rewritten.
        """
        asset_body, projection, _name = _validate_publish_payload(payload)
        if asset_id is not None:
            if not isinstance(asset_id, str) or not is_id(asset_id):
                raise VectorProjectionInvalid("assetId must be a UUID id")
        revision_id = str(uuid.uuid4())
        with self._lock:
            if asset_id is None:
                asset_id = str(uuid.uuid4())
                revision = 1
            else:
                revision = self._next_revision(asset_id)
            entry = {
                "revisionId": revision_id,
                "assetId": asset_id,
                "revision": revision,
                "asset": {**asset_body, "id": revision_id},
                "projection": projection,
            }
            self._write_unlocked(revision_id, entry)
            return entry

    def publish_export(
        self,
        export: CadProjectionExport,
        *,
        name: str | None = None,
        asset_id: str | None = None,
    ) -> dict[str, Any]:
        """Publish a library export as an immutable asset revision."""
        label = name or f"CAD {export.view_class} · {export.view}"
        return self.publish(
            {
                "name": label,
                "svg": export.svg,
                "projection": export.provenance,
            },
            asset_id=asset_id,
        )

    def regenerate(
        self,
        revision_id: str,
        expected_revision: int,
        *,
        name: str | None = None,
    ) -> dict[str, Any]:
        """Re-project from a revision's provenance; publish a new immutable tip.

        ``expected_revision`` must match the asset lineage's current highest
        revision. Prior revisions are never rewritten. Requires
        ``provenance.source.path`` (STEP/XBF) or a resolvable
        ``provenance.source.documentId`` when a document path resolver is set.
        """
        if not isinstance(expected_revision, int) or isinstance(expected_revision, bool) or expected_revision < 1:
            raise VectorProjectionInvalid("expectedRevision must be a positive integer")
        prior = self.get(revision_id)
        export = reproject_from_provenance(
            prior["projection"],
            resolve_document_path=self.resolve_document_path,
        )
        label = name if name is not None else prior["asset"]["name"]
        asset_id = prior["assetId"]
        asset_body, projection, _ = _validate_publish_payload(
            {
                "name": label,
                "svg": export.svg,
                "projection": export.provenance,
            },
        )
        new_revision_id = str(uuid.uuid4())
        with self._lock:
            tip = self._highest_revision_unlocked(asset_id)
            if tip != expected_revision:
                raise VectorProjectionStaleRevision(expected=expected_revision, current=tip)
            entry = {
                "revisionId": new_revision_id,
                "assetId": asset_id,
                "revision": tip + 1,
                "asset": {**asset_body, "id": new_revision_id},
                "projection": projection,
            }
            self._write_unlocked(new_revision_id, entry)
            return entry

    def get(self, revision_id: str) -> dict[str, Any]:
        """Return a published revision, or raise ``VectorProjectionNotFound``."""
        if not isinstance(revision_id, str) or not is_id(revision_id):
            raise VectorProjectionNotFound(f"no projection revision {revision_id!r}")
        entry = self._load(revision_id)
        if entry is None:
            raise VectorProjectionNotFound(f"no projection revision {revision_id}")
        return entry

    def list(self) -> list[dict[str, Any]]:
        """Return every published revision (order is not part of the contract)."""
        if not self.root.exists():
            return []
        entries: list[dict[str, Any]] = []
        for folder in self.root.iterdir():
            if not folder.is_dir():
                continue
            entry = self._load(folder.name)
            if entry is not None:
                entries.append(entry)
        return entries

    def _highest_revision_unlocked(self, asset_id: str) -> int:
        highest = 0
        for entry in self.list():
            if entry["assetId"] == asset_id:
                highest = max(highest, entry["revision"])
        return highest

    def _next_revision(self, asset_id: str) -> int:
        return self._highest_revision_unlocked(asset_id) + 1

    def _folder(self, revision_id: str) -> Path:
        return self.root / revision_id

    def _path(self, revision_id: str) -> Path:
        return self._folder(revision_id) / DOCUMENT

    def _load(self, revision_id: str) -> dict[str, Any] | None:
        path = self._path(revision_id)
        try:
            raw = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return None
        try:
            entry = json.loads(raw)
        except json.JSONDecodeError:
            return None
        if not isinstance(entry, dict):
            return None
        if entry.get("revisionId") != revision_id:
            return None
        asset_id = entry.get("assetId")
        revision = entry.get("revision")
        asset = entry.get("asset")
        projection = entry.get("projection")
        if not isinstance(asset_id, str) or not is_id(asset_id):
            return None
        if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
            return None
        if not isinstance(asset, dict) or asset.get("id") != revision_id:
            return None
        try:
            parse_projection_provenance(projection)
        except CadProjectionError:
            return None
        return {
            "revisionId": revision_id,
            "assetId": asset_id,
            "revision": revision,
            "asset": asset,
            "projection": projection,
        }

    def _write_unlocked(self, revision_id: str, entry: dict[str, Any]) -> None:
        folder = self._folder(revision_id)
        path = self._path(revision_id)
        if path.exists():
            raise VectorProjectionImmutable(f"projection revision {revision_id} is immutable")
        folder.mkdir(parents=True, exist_ok=True)
        with state(folder):
            if path.exists():
                raise VectorProjectionImmutable(f"projection revision {revision_id} is immutable")
            payload = (json.dumps(entry, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(
                "utf-8",
            )
            write_bytes_atomic(path, payload)


def reproject_from_provenance(
    provenance: Any,
    *,
    resolve_document_path: DocumentPathResolver | None = None,
) -> CadProjectionExport:
    """Rebuild a CAD-accurate SVG from stored projection provenance.

    Prefers ``source.path`` (STEP/XBF). When only ``source.documentId`` is set,
    ``resolve_document_path`` must map that id to a readable STEP/XBF path.
    """
    try:
        projection = parse_projection_provenance(provenance)
    except CadProjectionError as error:
        raise VectorProjectionInvalid(str(error)) from error
    source = projection["source"]
    path = source.get("path")
    document_id = source.get("documentId")
    if not isinstance(path, str) or not path:
        if not isinstance(document_id, str) or not document_id:
            raise VectorProjectionInvalid(
                "regeneration requires provenance.source.path or provenance.source.documentId",
            )
        if resolve_document_path is None:
            raise VectorProjectionInvalid(
                "regeneration requires provenance.source.path "
                "(document-only sources need a document path resolver)",
            )
        try:
            resolved = resolve_document_path(document_id)
        except VectorProjectionInvalid:
            raise
        except Exception as error:  # noqa: BLE001 - surface resolver failures as invalid provenance
            raise VectorProjectionInvalid(
                f"could not resolve document {document_id}: {error}",
            ) from error
        path = str(resolved)
        if not path:
            raise VectorProjectionInvalid(
                f"document path resolver returned an empty path for {document_id}",
            )
    try:
        return project_file_to_svg(
            path,
            projection["view"],
            hidden_lines=projection["hiddenLines"],
            document_id=document_id if isinstance(document_id, str) else None,
            document_revision=source.get("documentRevision"),
        )
    except CadProjectionError as error:
        raise VectorProjectionInvalid(str(error)) from error


def export_file_projection(
    path: str | Path,
    view: str,
    *,
    hidden_lines: bool = True,
    document_id: str | None = None,
    document_revision: str | None = None,
    name: str | None = None,
    store: VectorProjectionStore | None = None,
    asset_id: str | None = None,
) -> dict[str, Any]:
    """Load a STEP/XBF, project it, and publish an immutable asset revision."""
    try:
        export = project_file_to_svg(
            path,
            view,
            hidden_lines=hidden_lines,
            document_id=document_id,
            document_revision=document_revision,
        )
    except CadProjectionError as error:
        raise VectorProjectionInvalid(str(error)) from error
    target = store if store is not None else VectorProjectionStore()
    return target.publish_export(export, name=name, asset_id=asset_id)


def export_document_projection(
    document_id: str,
    view: str,
    *,
    resolve_document_path: DocumentPathResolver,
    hidden_lines: bool = True,
    document_revision: str | None = None,
    name: str | None = None,
    store: VectorProjectionStore | None = None,
    asset_id: str | None = None,
) -> dict[str, Any]:
    """Resolve a held document id to its STEP/XBF path, project, and publish."""
    if not isinstance(document_id, str) or not document_id:
        raise VectorProjectionInvalid("documentId must be a non-empty string")
    try:
        path = resolve_document_path(document_id)
    except VectorProjectionInvalid:
        raise
    except Exception as error:  # noqa: BLE001 - surface resolver failures as invalid publish
        raise VectorProjectionInvalid(
            f"could not resolve document {document_id}: {error}",
        ) from error
    return export_file_projection(
        path,
        view,
        hidden_lines=hidden_lines,
        document_id=document_id,
        document_revision=document_revision,
        name=name,
        store=store,
        asset_id=asset_id,
    )

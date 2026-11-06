"""Immutable Vector Studio component catalog: publish creates a revision id.

Catalog components are append-only. Once published, a revision's bytes never
change; MCP and UI consumers look entries up by ``revisionId``. A later publish
for the same ``componentId`` allocates a new revision id rather than rewriting
the prior one. Untrusted component JSON is validated before any write lands.
"""

from __future__ import annotations

import json
import threading
import uuid
from pathlib import Path
from typing import Any

from cad._internal.atomic_replace import write_bytes_atomic
from cad.engine.ids import is_id
from cad.engine.places import state_dir
from cad.vector_project import MAX_AGGREGATE_SVG_BYTES, MAX_PROJECT_BYTES
from cad_server._internal.file_lock import state

__all__ = [
    "DOCUMENT",
    "FOLDER",
    "MAX_BODY_BYTES",
    "VectorCatalogImmutable",
    "VectorCatalogInvalid",
    "VectorCatalogNotFound",
    "VectorCatalogStore",
    "VectorCatalogStoreError",
]

FOLDER = "vector-catalog"
DOCUMENT = "revision.json"
# One component plus a small envelope for ids / revision counters.
MAX_BODY_BYTES = MAX_PROJECT_BYTES + 4096
_PROVENANCE = frozenset({"user-import", "source-derived"})


class VectorCatalogStoreError(ValueError):
    """Base error for the immutable Vector component catalog."""


class VectorCatalogInvalid(VectorCatalogStoreError):
    """Component payload failed shape or budget validation before write."""


class VectorCatalogNotFound(VectorCatalogStoreError):
    """No published revision for the given revision id."""


class VectorCatalogImmutable(VectorCatalogStoreError):
    """A published revision cannot be overwritten."""


def _component_payload(component: Any) -> dict[str, Any]:
    if isinstance(component, str):
        try:
            parsed = json.loads(component)
        except json.JSONDecodeError as error:
            raise VectorCatalogInvalid("component must be a JSON object") from error
        if not isinstance(parsed, dict):
            raise VectorCatalogInvalid("component must be a JSON object")
        return parsed
    if isinstance(component, dict):
        return component
    raise VectorCatalogInvalid("component must be a JSON object or string")


def _validate_component(component: Any) -> dict[str, Any]:
    raw = _component_payload(component)
    name = raw.get("name")
    category = raw.get("category")
    svg = raw.get("svg")
    provenance = raw.get("provenance")
    if not isinstance(name, str) or not name:
        raise VectorCatalogInvalid("component.name must be a non-empty string")
    if not isinstance(category, str) or not category:
        raise VectorCatalogInvalid("component.category must be a non-empty string")
    if not isinstance(svg, str):
        raise VectorCatalogInvalid("component.svg must be a string")
    if provenance not in _PROVENANCE:
        raise VectorCatalogInvalid("Invalid component provenance")
    svg_bytes = len(svg.encode("utf-8"))
    if svg_bytes > MAX_AGGREGATE_SVG_BYTES:
        raise VectorCatalogInvalid(
            f"component.svg exceeds MAX_AGGREGATE_SVG_BYTES ({MAX_AGGREGATE_SVG_BYTES})",
        )
    # Reject unknown keys so published revisions stay a closed shape for MCP/UI.
    allowed = {"name", "category", "svg", "provenance", "id"}
    if not set(raw) <= allowed:
        raise VectorCatalogInvalid("component has unknown fields")
    return {
        "name": name,
        "category": category,
        "svg": svg,
        "provenance": provenance,
    }


class VectorCatalogStore:
    """File-backed immutable catalog under ``<state>/vector-catalog/<revisionId>/``."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = Path(root) if root is not None else state_dir() / FOLDER
        self._lock = threading.Lock()

    def publish(self, component: Any, component_id: str | None = None) -> dict[str, Any]:
        """Validate then publish a new immutable revision.

        Passing ``component_id`` advances that lineage's revision counter; omitting
        it starts a new component at revision 1. Prior revisions are never rewritten.
        """
        validated = _validate_component(component)
        if component_id is not None:
            if not isinstance(component_id, str) or not is_id(component_id):
                raise VectorCatalogInvalid("componentId must be a UUID id")
        revision_id = str(uuid.uuid4())
        with self._lock:
            if component_id is None:
                component_id = str(uuid.uuid4())
                revision = 1
            else:
                revision = self._next_revision(component_id)
            entry = {
                "revisionId": revision_id,
                "componentId": component_id,
                "revision": revision,
                "component": {**validated, "id": revision_id},
            }
            self._write_unlocked(revision_id, entry)
            return entry

    def get(self, revision_id: str) -> dict[str, Any]:
        """Return a published revision, or raise ``VectorCatalogNotFound``."""
        if not isinstance(revision_id, str) or not is_id(revision_id):
            raise VectorCatalogNotFound(f"no catalog revision {revision_id!r}")
        entry = self._load(revision_id)
        if entry is None:
            raise VectorCatalogNotFound(f"no catalog revision {revision_id}")
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

    def _next_revision(self, component_id: str) -> int:
        highest = 0
        for entry in self.list():
            if entry["componentId"] == component_id:
                highest = max(highest, entry["revision"])
        return highest + 1

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
        component_id = entry.get("componentId")
        revision = entry.get("revision")
        component = entry.get("component")
        if not isinstance(component_id, str) or not is_id(component_id):
            return None
        if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
            return None
        if not isinstance(component, dict):
            return None
        if component.get("id") != revision_id:
            return None
        return {
            "revisionId": revision_id,
            "componentId": component_id,
            "revision": revision,
            "component": component,
        }

    def _write_unlocked(self, revision_id: str, entry: dict[str, Any]) -> None:
        """Write a revision file once. Existing files are immutable — raise instead."""
        folder = self._folder(revision_id)
        path = self._path(revision_id)
        if path.exists():
            raise VectorCatalogImmutable(f"catalog revision {revision_id} is immutable")
        folder.mkdir(parents=True, exist_ok=True)
        # Re-check under the folder lock so concurrent publishes cannot clobber.
        with state(folder):
            if path.exists():
                raise VectorCatalogImmutable(f"catalog revision {revision_id} is immutable")
            payload = (json.dumps(entry, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(
                "utf-8",
            )
            write_bytes_atomic(path, payload)

"""Durable Vector Studio project store: UUID documents with optimistic revisions.

Server-authoritative; client drafts remain a recoverable overlay over these
revisions. Untrusted project JSON is rejected with
``cad.vector_project.parse_vector_project`` before any write lands.
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
from cad.vector_project import MAX_PROJECT_BYTES, VectorProjectError, parse_vector_project
from cad_server._internal.file_lock import state

__all__ = [
    "DOCUMENT",
    "FOLDER",
    "MAX_BODY_BYTES",
    "VectorProjectInvalid",
    "VectorProjectNotFound",
    "VectorProjectStaleRevision",
    "VectorProjectStore",
    "VectorProjectStoreError",
]

FOLDER = "vector-projects"
DOCUMENT = "document.json"
# Project budgets plus a small envelope for id / revision / expectedRevision.
MAX_BODY_BYTES = MAX_PROJECT_BYTES + 4096


class VectorProjectStoreError(ValueError):
    """Base error for the durable Vector project store."""


class VectorProjectInvalid(VectorProjectStoreError):
    """Project text failed schema or budget validation before write."""


class VectorProjectNotFound(VectorProjectStoreError):
    """No durable document for the given id."""


class VectorProjectStaleRevision(VectorProjectStoreError):
    """Update expected a revision that is no longer current."""

    def __init__(self, *, expected: int, current: int) -> None:
        super().__init__(f"expected revision {expected}, current is {current}")
        self.expected = expected
        self.current = current


def _project_text(project: Any) -> str:
    if isinstance(project, str):
        return project
    if isinstance(project, (dict, list)):
        return json.dumps(project, ensure_ascii=False, separators=(",", ":"))
    raise VectorProjectInvalid("project must be a JSON object or string")


class VectorProjectStore:
    """File-backed UUID/revision store under ``<state>/vector-projects/<id>/``."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = Path(root) if root is not None else state_dir() / FOLDER
        self._lock = threading.Lock()

    def create(self, project: Any) -> dict[str, Any]:
        """Validate then create a new document at revision 1."""
        validated = self._validate(project)
        ident = str(uuid.uuid4())
        document = {"id": ident, "revision": 1, "project": validated}
        self._write(ident, document)
        return document

    def get(self, ident: str) -> dict[str, Any]:
        """Return the durable document, or raise ``VectorProjectNotFound``."""
        if not isinstance(ident, str) or not is_id(ident):
            raise VectorProjectNotFound(f"no vector project {ident!r}")
        document = self._load(ident)
        if document is None:
            raise VectorProjectNotFound(f"no vector project {ident}")
        return document

    def update(self, ident: str, expected_revision: int, project: Any) -> dict[str, Any]:
        """Validate, then replace the document when ``expected_revision`` matches.

        Invalid projects are rejected before any lock or write. A mismatched
        revision raises ``VectorProjectStaleRevision`` and leaves the file untouched.
        """
        if not isinstance(ident, str) or not is_id(ident):
            raise VectorProjectNotFound(f"no vector project {ident!r}")
        if not isinstance(expected_revision, int) or isinstance(expected_revision, bool) or expected_revision < 1:
            raise VectorProjectInvalid("expectedRevision must be a positive integer")
        validated = self._validate(project)
        folder = self._folder(ident)
        folder.mkdir(parents=True, exist_ok=True)
        with self._lock, state(folder):
            current = self._load(ident)
            if current is None:
                raise VectorProjectNotFound(f"no vector project {ident}")
            current_revision = current["revision"]
            if current_revision != expected_revision:
                raise VectorProjectStaleRevision(expected=expected_revision, current=current_revision)
            document = {
                "id": ident,
                "revision": expected_revision + 1,
                "project": validated,
            }
            self._write_unlocked(ident, document)
            return document

    def _validate(self, project: Any) -> dict[str, Any]:
        try:
            return parse_vector_project(_project_text(project))
        except VectorProjectError as error:
            raise VectorProjectInvalid(str(error)) from error

    def _folder(self, ident: str) -> Path:
        return self.root / ident

    def _path(self, ident: str) -> Path:
        return self._folder(ident) / DOCUMENT

    def _load(self, ident: str) -> dict[str, Any] | None:
        path = self._path(ident)
        try:
            raw = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return None
        try:
            document = json.loads(raw)
        except json.JSONDecodeError:
            return None
        if not isinstance(document, dict):
            return None
        if document.get("id") != ident:
            return None
        revision = document.get("revision")
        project = document.get("project")
        if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
            return None
        if not isinstance(project, dict):
            return None
        return {"id": ident, "revision": revision, "project": project}

    def _write(self, ident: str, document: dict[str, Any]) -> None:
        folder = self._folder(ident)
        folder.mkdir(parents=True, exist_ok=True)
        with self._lock, state(folder):
            self._write_unlocked(ident, document)

    def _write_unlocked(self, ident: str, document: dict[str, Any]) -> None:
        payload = (json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
        write_bytes_atomic(self._path(ident), payload)

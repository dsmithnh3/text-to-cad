"""Typed Vector Studio MCP tools: durable projects and immutable catalog.

Mutations require ``expectedRevision``. Catalog components are looked up by
``revisionId`` only; there is no catalog update tool. Tools call the viewer
stores directly (same process as the engine), not HTTP.
"""

from __future__ import annotations

from typing import Any

from cad_server.viewer.vector_catalog import (
    VectorCatalogImmutable,
    VectorCatalogInvalid,
    VectorCatalogNotFound,
    VectorCatalogStore,
)
from cad_server.viewer.vector_projects import (
    VectorProjectInvalid,
    VectorProjectNotFound,
    VectorProjectStaleRevision,
    VectorProjectStore,
)

__all__ = [
    "VECTOR_TOOLS",
    "catalog",
    "handle",
]

_READ_ONLY = {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False}
_MUTATING = {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False, "openWorldHint": False}


def _object(properties: dict[str, Any] | None = None, required: list[str] | None = None) -> dict[str, Any]:
    schema: dict[str, Any] = {"type": "object", "properties": properties or {}, "additionalProperties": False}
    if required:
        schema["required"] = required
    return schema


_PROJECT = {
    "type": "object",
    "description": "A cad-vector-studio/v1 project object (validated before write).",
}
_ID = {"type": "string", "minLength": 1, "description": "Durable Vector project UUID."}
_REVISION = {
    "type": "integer",
    "minimum": 1,
    "description": "Optimistic concurrency token; required on every mutation.",
}
_REVISION_ID = {
    "type": "string",
    "minLength": 1,
    "description": "Immutable catalog revision id published by vector_catalog_publish.",
}
_COMPONENT = {
    "type": "object",
    "description": "Catalog component: name, category, svg, provenance (user-import|source-derived).",
    "properties": {
        "name": {"type": "string", "minLength": 1},
        "category": {"type": "string", "minLength": 1},
        "svg": {"type": "string"},
        "provenance": {"type": "string", "enum": ["user-import", "source-derived"]},
    },
    "required": ["name", "category", "svg", "provenance"],
    "additionalProperties": False,
}

VECTOR_TOOLS = (
    "vector_project_create",
    "vector_project_get",
    "vector_project_update",
    "vector_catalog_publish",
    "vector_catalog_get",
    "vector_catalog_list",
)


def catalog() -> list[dict[str, Any]]:
    """Agent-facing Vector tools (all MCP presentations)."""
    return [
        {
            "name": "vector_project_create",
            "title": "Create Vector project",
            "description": (
                "Create a durable Vector Studio project. Validates the project before write and "
                "returns {id, revision, project} at revision 1. Client drafts remain a recoverable overlay."
            ),
            "inputSchema": _object({"project": _PROJECT}, ["project"]),
            "annotations": _MUTATING,
        },
        {
            "name": "vector_project_get",
            "title": "Get Vector project",
            "description": "Read a durable Vector Studio project by UUID.",
            "inputSchema": _object({"id": _ID}, ["id"]),
            "annotations": _READ_ONLY,
        },
        {
            "name": "vector_project_update",
            "title": "Update Vector project",
            "description": (
                "Replace a durable Vector Studio project when expectedRevision matches. "
                "Invalid projects are rejected before write; a stale revision returns an error "
                "with currentRevision."
            ),
            "inputSchema": _object(
                {"id": _ID, "expectedRevision": _REVISION, "project": _PROJECT},
                ["id", "expectedRevision", "project"],
            ),
            "annotations": _MUTATING,
        },
        {
            "name": "vector_catalog_publish",
            "title": "Publish Vector catalog component",
            "description": (
                "Publish an immutable catalog component revision. Allocates a new revisionId; "
                "prior revisions are never rewritten. Optional componentId advances that component's "
                "revision counter."
            ),
            "inputSchema": _object(
                {
                    "component": _COMPONENT,
                    "componentId": {"type": "string", "minLength": 1, "description": "Optional lineage id."},
                },
                ["component"],
            ),
            "annotations": _MUTATING,
        },
        {
            "name": "vector_catalog_get",
            "title": "Get Vector catalog revision",
            "description": "Look up an immutable catalog component by revisionId.",
            "inputSchema": _object({"revisionId": _REVISION_ID}, ["revisionId"]),
            "annotations": _READ_ONLY,
        },
        {
            "name": "vector_catalog_list",
            "title": "List Vector catalog",
            "description": "List published immutable catalog revisions for MCP/UI library browsing.",
            "inputSchema": _object(),
            "annotations": _READ_ONLY,
        },
    ]


class VectorToolError(Exception):
    """A Vector tool failure the agent should read as the tool result."""

    def __init__(self, message: str, *, structured: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.structured = structured or {}


def _projects(store: VectorProjectStore | None) -> VectorProjectStore:
    return store if store is not None else VectorProjectStore()


def _catalog(store: VectorCatalogStore | None) -> VectorCatalogStore:
    return store if store is not None else VectorCatalogStore()


def handle(
    name: str,
    arguments: dict[str, Any],
    *,
    projects: VectorProjectStore | None = None,
    catalog_store: VectorCatalogStore | None = None,
) -> dict[str, Any]:
    """Dispatch a Vector tool. Raises ``VectorToolError`` for agent-visible failures."""
    if name == "vector_project_create":
        try:
            document = _projects(projects).create(arguments.get("project"))
        except VectorProjectInvalid as error:
            raise VectorToolError(str(error)) from error
        return document

    if name == "vector_project_get":
        try:
            return _projects(projects).get(arguments.get("id"))
        except VectorProjectNotFound as error:
            raise VectorToolError(str(error)) from error

    if name == "vector_project_update":
        expected = arguments.get("expectedRevision")
        if not isinstance(expected, int) or isinstance(expected, bool) or expected < 1:
            raise VectorToolError("expectedRevision must be a positive integer")
        try:
            return _projects(projects).update(arguments.get("id"), expected, arguments.get("project"))
        except VectorProjectInvalid as error:
            raise VectorToolError(str(error)) from error
        except VectorProjectNotFound as error:
            raise VectorToolError(str(error)) from error
        except VectorProjectStaleRevision as error:
            raise VectorToolError(str(error), structured={"currentRevision": error.current}) from error

    if name == "vector_catalog_publish":
        try:
            return _catalog(catalog_store).publish(arguments.get("component"), arguments.get("componentId"))
        except VectorCatalogInvalid as error:
            raise VectorToolError(str(error)) from error
        except VectorCatalogImmutable as error:
            raise VectorToolError(str(error)) from error

    if name == "vector_catalog_get":
        try:
            return _catalog(catalog_store).get(arguments.get("revisionId"))
        except VectorCatalogNotFound as error:
            raise VectorToolError(str(error)) from error

    if name == "vector_catalog_list":
        return {"entries": _catalog(catalog_store).list()}

    raise VectorToolError(f"unknown Vector tool {name!r}")

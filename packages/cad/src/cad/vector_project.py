"""Bounded Vector Studio project parse/validate.

Untrusted JSON must fail before a durable store, draft, or render path commits it.
Budgets and accept/reject cases are locked by the language-neutral fixture that
``@cad/core``'s ``vectorProject.js`` also asserts (``vectorProject.conformance.json``).
"""

from __future__ import annotations

import json
import math
from typing import Any, Mapping

__all__ = [
    "MAX_AGGREGATE_SVG_BYTES",
    "MAX_ASSET_COUNT",
    "MAX_DIMENSION",
    "MAX_ITEM_COUNT",
    "MAX_PROJECT_BYTES",
    "VectorProjectError",
    "parse_vector_project",
]

MAX_PROJECT_BYTES = 8_000_000
MAX_ASSET_COUNT = 500
MAX_ITEM_COUNT = 2_000
MAX_AGGREGATE_SVG_BYTES = 6_000_000
MAX_DIMENSION = 100_000

_SCHEMA = "cad-vector-studio/v1"
_PROVENANCE = frozenset({"user-import", "source-derived"})


class VectorProjectError(ValueError):
    """Project text failed budget or shape validation."""


def _utf8_bytes(text: str) -> int:
    return len(text.encode("utf-8"))


def _require_finite(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise VectorProjectError(f"Non-finite {label}")
    return float(value)


def _require_positive_size(value: Any, label: str) -> float:
    number = _require_finite(value, label)
    if not (number > 0) or number > MAX_DIMENSION:
        raise VectorProjectError(f"Invalid {label}")
    return number


def _require_dimension(value: Any, label: str) -> float:
    number = _require_finite(value, label)
    if not (number > 0) or number > MAX_DIMENSION:
        raise VectorProjectError(f"Invalid {label}")
    return number


def _require_string(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise VectorProjectError(f"Invalid {label}")
    return value


def _require_boolean(value: Any, label: str) -> bool:
    if not isinstance(value, bool):
        raise VectorProjectError(f"Invalid {label}")
    return value


def _parse_asset(raw: Any, index: int) -> dict[str, Any]:
    if not isinstance(raw, Mapping):
        raise VectorProjectError(f"Invalid asset at {index}")
    provenance = raw.get("provenance")
    if provenance not in _PROVENANCE:
        raise VectorProjectError(f"Invalid asset provenance at {index}")
    return {
        "id": _require_string(raw.get("id"), f"asset.id[{index}]"),
        "name": _require_string(raw.get("name"), f"asset.name[{index}]"),
        "category": _require_string(raw.get("category"), f"asset.category[{index}]"),
        "svg": _require_string(raw.get("svg"), f"asset.svg[{index}]"),
        "provenance": provenance,
    }


def _parse_item(raw: Any, index: int) -> dict[str, Any]:
    if not isinstance(raw, Mapping):
        raise VectorProjectError(f"Invalid item at {index}")
    return {
        "id": _require_string(raw.get("id"), f"item.id[{index}]"),
        "assetId": _require_string(raw.get("assetId"), f"item.assetId[{index}]"),
        "name": _require_string(raw.get("name"), f"item.name[{index}]"),
        "x": _require_finite(raw.get("x"), f"item.x[{index}]"),
        "y": _require_finite(raw.get("y"), f"item.y[{index}]"),
        "w": _require_positive_size(raw.get("w"), f"item.w[{index}]"),
        "h": _require_positive_size(raw.get("h"), f"item.h[{index}]"),
        "rotate": _require_finite(raw.get("rotate"), f"item.rotate[{index}]"),
        "opacity": _require_finite(raw.get("opacity"), f"item.opacity[{index}]"),
        "hidden": _require_boolean(raw.get("hidden"), f"item.hidden[{index}]"),
        "locked": _require_boolean(raw.get("locked"), f"item.locked[{index}]"),
    }


def parse_vector_project(text: str) -> dict[str, Any]:
    """Parse and validate a Vector Studio project JSON string.

    Rejects over-budget and non-finite input before any caller writes or commits it.
    """
    if not isinstance(text, str):
        raise VectorProjectError("Project text must be a string")
    if _utf8_bytes(text) > MAX_PROJECT_BYTES:
        raise VectorProjectError(f"Project exceeds MAX_PROJECT_BYTES ({MAX_PROJECT_BYTES})")

    try:
        raw = json.loads(text)
    except json.JSONDecodeError as exc:
        raise VectorProjectError("Malformed project JSON") from exc
    if not isinstance(raw, Mapping):
        raise VectorProjectError("Project must be an object")
    if raw.get("schema") != _SCHEMA:
        raise VectorProjectError("Unsupported project schema")
    assets_raw = raw.get("assets")
    items_raw = raw.get("items")
    if not isinstance(assets_raw, list):
        raise VectorProjectError("Project assets must be an array")
    if not isinstance(items_raw, list):
        raise VectorProjectError("Project items must be an array")
    if len(assets_raw) > MAX_ASSET_COUNT:
        raise VectorProjectError(f"Asset count exceeds MAX_ASSET_COUNT ({MAX_ASSET_COUNT})")
    if len(items_raw) > MAX_ITEM_COUNT:
        raise VectorProjectError(f"Item count exceeds MAX_ITEM_COUNT ({MAX_ITEM_COUNT})")

    assets = [_parse_asset(asset, index) for index, asset in enumerate(assets_raw)]
    aggregate_svg_bytes = 0
    for asset in assets:
        aggregate_svg_bytes += _utf8_bytes(asset["svg"])
        if aggregate_svg_bytes > MAX_AGGREGATE_SVG_BYTES:
            raise VectorProjectError(
                f"Aggregate SVG bytes exceed MAX_AGGREGATE_SVG_BYTES ({MAX_AGGREGATE_SVG_BYTES})",
            )

    items = [_parse_item(item, index) for index, item in enumerate(items_raw)]
    return {
        "schema": _SCHEMA,
        "name": _require_string(raw.get("name"), "name"),
        "width": _require_dimension(raw.get("width"), "width"),
        "height": _require_dimension(raw.get("height"), "height"),
        "assets": assets,
        "items": items,
    }

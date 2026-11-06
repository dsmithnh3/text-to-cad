"""CAD-accurate hidden-line projection to SVG for Vector Studio.

Orthographic and isometric views use the same OCCT HLR path as engineering
drawings. The result is an editable SVG plus structured provenance so a later
regeneration can rebuild the same view from the source document.

This is distinct from the browser's illustrative GLB mesh projection, which
tessellates triangles and must never be labeled as CAD-accurate.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Mapping

from cad.eng_drawing import VIEW_DIRECTIONS, _Projection, _edge_polyline, _edges_bounds

__all__ = [
    "BACKEND",
    "CadProjectionError",
    "CadProjectionExport",
    "ILLUSTRATIVE_MESH_KIND",
    "ISOMETRIC_VIEWS",
    "KIND",
    "ORTHOGRAPHIC_VIEWS",
    "PROJECTION_VIEWS",
    "build_projection_provenance",
    "parse_projection_provenance",
    "project_file_to_svg",
    "project_shape_to_svg",
    "view_class_for",
]

_STEP_SUFFIXES = (".step", ".stp")
_XBF_SUFFIXES = (".xbf",)

KIND = "cad-projection"
ILLUSTRATIVE_MESH_KIND = "illustrative-mesh"
BACKEND = "hlr-occt"

ORTHOGRAPHIC_VIEWS = frozenset({"top", "bottom", "front", "back", "left", "right"})
ISOMETRIC_VIEWS = frozenset({"iso"})
PROJECTION_VIEWS = frozenset(VIEW_DIRECTIONS)

_VISIBLE_STROKE = "#1f2937"
_HIDDEN_STROKE = "#94a3b8"
_PADDING = 12.0


class CadProjectionError(ValueError):
    """Projection view or provenance failed validation."""


class CadProjectionExport:
    """SVG bytes plus provenance describing how they were produced."""

    __slots__ = ("svg", "view", "view_class", "hidden_lines", "provenance")

    def __init__(
        self,
        *,
        svg: str,
        view: str,
        view_class: str,
        hidden_lines: bool,
        provenance: dict[str, Any],
    ) -> None:
        self.svg = svg
        self.view = view
        self.view_class = view_class
        self.hidden_lines = hidden_lines
        self.provenance = provenance

    def as_dict(self) -> dict[str, Any]:
        return {
            "svg": self.svg,
            "view": self.view,
            "viewClass": self.view_class,
            "hiddenLines": self.hidden_lines,
            "provenance": dict(self.provenance),
        }


def view_class_for(view: str) -> str:
    """Return ``orthographic`` or ``isometric`` for a known view name."""
    if view not in PROJECTION_VIEWS:
        raise CadProjectionError(
            f"unknown projection view {view!r}; one of {sorted(PROJECTION_VIEWS)}",
        )
    if view in ISOMETRIC_VIEWS:
        return "isometric"
    return "orthographic"


def build_projection_provenance(
    *,
    view: str,
    hidden_lines: bool = True,
    source_path: str | None = None,
    document_id: str | None = None,
    document_revision: str | None = None,
) -> dict[str, Any]:
    """Build the closed provenance object stored with an immutable asset revision."""
    view_class = view_class_for(view)
    source: dict[str, Any] = {}
    if source_path is not None:
        if not isinstance(source_path, str) or not source_path:
            raise CadProjectionError("source.path must be a non-empty string")
        source["path"] = source_path
    if document_id is not None:
        if not isinstance(document_id, str) or not document_id:
            raise CadProjectionError("source.documentId must be a non-empty string")
        source["documentId"] = document_id
    if document_revision is not None:
        if not isinstance(document_revision, str) or not document_revision:
            raise CadProjectionError("source.documentRevision must be a non-empty string")
        source["documentRevision"] = document_revision
    if not source:
        raise CadProjectionError(
            "provenance requires source.path and/or source.documentId",
        )
    return {
        "kind": KIND,
        "backend": BACKEND,
        "view": view,
        "viewClass": view_class,
        "hiddenLines": bool(hidden_lines),
        "source": source,
    }


def parse_projection_provenance(raw: Any) -> dict[str, Any]:
    """Validate projection provenance; reject illustrative-mesh and unknown shapes."""
    if not isinstance(raw, Mapping):
        raise CadProjectionError("projection provenance must be an object")
    kind = raw.get("kind")
    if kind == ILLUSTRATIVE_MESH_KIND:
        raise CadProjectionError(
            "illustrative mesh projection is not a CAD-accurate projection asset",
        )
    if kind != KIND:
        raise CadProjectionError(f"unknown projection kind {kind!r}")
    backend = raw.get("backend")
    if backend != BACKEND:
        raise CadProjectionError(f"unsupported projection backend {backend!r}")
    view = raw.get("view")
    if not isinstance(view, str) or view not in PROJECTION_VIEWS:
        raise CadProjectionError(
            f"unknown projection view {view!r}; one of {sorted(PROJECTION_VIEWS)}",
        )
    view_class = raw.get("viewClass")
    expected_class = view_class_for(view)
    if view_class != expected_class:
        raise CadProjectionError(
            f"viewClass {view_class!r} does not match view {view!r} ({expected_class})",
        )
    hidden = raw.get("hiddenLines")
    if not isinstance(hidden, bool):
        raise CadProjectionError("hiddenLines must be a boolean")
    source = raw.get("source")
    if not isinstance(source, Mapping) or not source:
        raise CadProjectionError("provenance.source must be a non-empty object")
    allowed_source = {"path", "documentId", "documentRevision"}
    if not set(source) <= allowed_source:
        raise CadProjectionError("provenance.source has unknown fields")
    if not ({"path", "documentId"} & set(source)):
        raise CadProjectionError(
            "provenance.source requires path and/or documentId",
        )
    cleaned_source: dict[str, Any] = {}
    for key in ("path", "documentId", "documentRevision"):
        if key not in source:
            continue
        value = source[key]
        if not isinstance(value, str) or not value:
            raise CadProjectionError(f"source.{key} must be a non-empty string")
        cleaned_source[key] = value
    allowed = {"kind", "backend", "view", "viewClass", "hiddenLines", "source"}
    if not set(raw) <= allowed:
        raise CadProjectionError("projection provenance has unknown fields")
    return {
        "kind": KIND,
        "backend": BACKEND,
        "view": view,
        "viewClass": expected_class,
        "hiddenLines": hidden,
        "source": cleaned_source,
    }


def _load_shape_from_path(file_path: Path) -> Any:
    """Read a STEP/XBF as a build123d shape (kernel entry points stay in the library)."""
    if not file_path.is_file():
        raise CadProjectionError(f"no CAD file at {file_path}")
    suffix = file_path.suffix.lower()
    if suffix in _STEP_SUFFIXES:
        from cad.engine.document import read_step_shape

        return read_step_shape(file_path)
    if suffix in _XBF_SUFFIXES:
        from cad.engine.document import read_xbf_shape

        return read_xbf_shape(file_path)
    raise CadProjectionError("CAD projection reads a .step/.stp or .xbf file")


def project_file_to_svg(
    path: str | Path,
    view: str,
    *,
    hidden_lines: bool = True,
    document_id: str | None = None,
    document_revision: str | None = None,
    padding: float = _PADDING,
) -> CadProjectionExport:
    """Load a STEP/XBF from disk and project it to CAD-accurate SVG.

    Shape loading stays in the library so host adapters (viewer HTTP, agent tools)
    never name kernel build entry points.
    """
    file_path = Path(path)
    shape = _load_shape_from_path(file_path)
    return project_shape_to_svg(
        shape,
        view,
        hidden_lines=hidden_lines,
        source_path=str(file_path.resolve()),
        document_id=document_id,
        document_revision=document_revision,
        padding=padding,
    )


def project_shape_to_svg(
    shape: Any,
    view: str,
    *,
    hidden_lines: bool = True,
    source_path: str | None = None,
    document_id: str | None = None,
    document_revision: str | None = None,
    padding: float = _PADDING,
) -> CadProjectionExport:
    """Project a build123d shape to CAD-accurate SVG for ``view``.

    ``view`` is one of the engineering-drawing names (orthographic or ``iso``).
    Provenance always names this path as ``cad-projection`` / ``hlr-occt``.
    """
    view_class = view_class_for(view)
    provenance = build_projection_provenance(
        view=view,
        hidden_lines=hidden_lines,
        source_path=source_path,
        document_id=document_id,
        document_revision=document_revision,
    )
    proj = _Projection(shape, view)
    visible = list(proj.visible)
    hidden = list(proj.hidden) if hidden_lines else []
    edges = visible + hidden
    bounds = _edges_bounds(edges)
    if bounds is None:
        raise CadProjectionError(f"projection view {view!r} produced no edges")
    x0, x1, y0, y1 = bounds
    width = max(x1 - x0, 1e-9)
    height = max(y1 - y0, 1e-9)
    pad = float(padding)
    if not math.isfinite(pad) or pad < 0:
        raise CadProjectionError("padding must be a non-negative finite number")
    svg_w = width + 2 * pad
    svg_h = height + 2 * pad

    def map_point(x: float, y: float) -> tuple[float, float]:
        # SVG Y grows downward; HLR viewport Y grows upward.
        return (x - x0 + pad, (y1 - y) + pad)

    body: list[str] = []
    seen: set[tuple] = set()

    def once(key: tuple) -> bool:
        if key in seen:
            return False
        seen.add(key)
        return True

    def q(value: float) -> float:
        return round(value, 6)

    def emit(edges_in, *, dashed: bool) -> None:
        from build123d import GeomType

        stroke = _HIDDEN_STROKE if dashed else _VISIBLE_STROKE
        dash = ' stroke-dasharray="4 3"' if dashed else ""
        group = ['<g fill="none" stroke="', stroke, '" stroke-width="1"', dash, ">"]
        for edge in edges_in:
            if edge.geom_type == GeomType.CIRCLE and edge.is_closed:
                c = map_point(edge.arc_center.X, edge.arc_center.Y)
                r = float(edge.radius)
                key = ("circle", q(c[0]), q(c[1]), q(r))
                if once(key):
                    group.append(
                        f'<circle cx="{q(c[0])}" cy="{q(c[1])}" r="{q(r)}"/>',
                    )
                continue
            poly = [map_point(x, y) for x, y in _edge_polyline(edge)]
            points = tuple((q(x), q(y)) for x, y in poly)
            key = ("poly", min(points, points[::-1]))
            if not once(key):
                continue
            if len(poly) == 2:
                (ax, ay), (bx, by) = poly
                group.append(
                    f'<line x1="{q(ax)}" y1="{q(ay)}" x2="{q(bx)}" y2="{q(by)}"/>',
                )
            else:
                d = "M " + " L ".join(f"{q(x)} {q(y)}" for x, y in poly)
                group.append(f'<path d="{d}"/>')
        group.append("</g>")
        body.append("".join(group))

    emit(visible, dashed=False)
    if hidden_lines:
        emit(hidden, dashed=True)

    title = f"CAD {view_class} projection ({view})"
    desc = (
        "CAD-accurate OCCT hidden-line projection. "
        "Not an illustrative mesh triangle export."
    )
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {q(svg_w)} {q(svg_h)}">'
        f"<title>{title}</title><desc>{desc}</desc>"
        f'{"".join(body)}</svg>'
    )
    return CadProjectionExport(
        svg=svg,
        view=view,
        view_class=view_class,
        hidden_lines=hidden_lines,
        provenance=provenance,
    )

---
name: cad-to-isometric-svg
description: Generate editable orthographic-isometric SVG from CAD models for the unified vector workspace, preferring CAD-accurate projection when available.
metadata:
  repository: earthtojake/text-to-cad
---
# CAD-to-isometric SVG

Generate CAD normally through text-to-cad (do not bypass its existing engine, models, export service, or CAD viewer). Prefer CAD-accurate projection for Vector Studio assets; keep the browser GLB importer as an illustrative fallback.

## Typical sequence (CAD-accurate)
1. Use the installed CAD skill to author and run the Python model. Use the document identity printed by the build; Python source files are not Viewer documents.
2. Inspect the built document in the original CAD Viewer and export STEP/XBF (or use an absolute path already on disk).
3. Publish a projection with MCP `vector_projection_publish` (`file` + `view`, e.g. `iso` / orthographic faces) or `POST /api/v1/vector/projections`. This creates an immutable asset revision with provenance.
4. To rebuild after the source changes, call `vector_projection_regenerate` with `revisionId` and matching `expectedRevision`. Regeneration requires path-backed provenance (`source.path`); document-id-only provenance cannot regenerate yet.
5. Place the published SVG asset into a Vector Studio project (`vector_project_*` or the Vector UI). Keep engineering dimensions in CAD / DXF / engineering-drawing skills.

## Illustrative fallback (browser only)
Switch the Viewer to Vector Studio and choose **Import GLB**. This browser action creates a local editable polygon asset from mesh triangles. Current MCP tools do **not** perform Import GLB. The result is an **illustration adapter**, not an exact CAD hidden-line drawing; hidden-face sorting, mesh topology, edge visibility, source part identity and units require review. Never claim it is CAD-accurate geometry.

## Vector Studio handoff
Set drawn size/rotation, layer with catalog or library components, use structured SVG controls for editable nodes, and save an editable JSON project plus vector SVG export. Project JSON must stay within aggregate budgets (see `docs/unified-cad-vector-studio.md`).

## Validation
Compare 3D and 2D views by fixed reference poses, confirm faces and orientations, and inspect projections for depth-sorting or HLR omissions. Keep dimensions and native engineering STEP/DXF views in CAD, rather than deriving precise dimensions from stylized or illustrative SVG.

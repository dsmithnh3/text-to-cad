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
2. Inspect the built document in the original CAD Viewer (or use an absolute STEP/XBF path already on disk).
3. Publish a CAD-accurate projection one of these ways:
   - **Viewer:** File ⋯ → **Publish CAD projection** → Isometric / Front / Top / Right (publishes OCCT HLR, switches to Vector Studio, and lists the asset in Library).
   - **MCP / HTTP:** `vector_projection_publish` with `file`+`view` or held `documentId`+`view`, or `POST /api/v1/vector/projections`.
4. To rebuild after the source changes, call `vector_projection_regenerate` with `revisionId` and matching `expectedRevision`. Regeneration uses `source.path` when present; document-id-only provenance regenerates when the engine still holds that document (path resolved from the held document).
5. Place the published SVG from Vector Studio Library (or via `vector_project_*`). For **dimensioned production drawings or cut DXF**, hand off to the engineering-drawing / DXF skills on the CAD model — projected SVG is composition, not a manufacturing drawing.

## Illustrative fallback (browser only)
Switch the Viewer to Vector Studio and choose **Import GLB**. This browser action creates a local editable polygon asset from mesh triangles. Current MCP tools do **not** perform Import GLB. The result is an **illustration adapter**, not an exact CAD hidden-line drawing; hidden-face sorting, mesh topology, edge visibility, source part identity and units require review. Never claim it is CAD-accurate geometry.

## Vector Studio handoff
Set drawn size/rotation, layer with catalog or library components, use structured SVG controls for editable nodes, and save an editable JSON project plus vector SVG export. Project JSON must stay within aggregate budgets (see `docs/unified-cad-vector-studio.md`).

## Validation
Compare 3D and 2D views by fixed reference poses, confirm faces and orientations, and inspect projections for depth-sorting or HLR omissions. Keep dimensions and native engineering STEP/DXF views in CAD, rather than deriving precise dimensions from stylized or illustrative SVG.

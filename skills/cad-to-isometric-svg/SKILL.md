---
name: cad-to-isometric-svg
description: Generate editable orthographic-isometric SVG illustrations from CAD-generated GLB files, using the unified vector workspace.
metadata:
  repository: earthtojake/text-to-cad
---
# CAD-to-isometric SVG

Generate CAD normally through text-to-cad (do not bypass its existing engine, models, export service, or CAD viewer). Request a GLB export, then use Vector Studio's built-in GLB import.

## Typical sequence
1. Use the installed CAD skill to author and run the Python model. Use the document identity printed by the build; Python source files are not Viewer documents.
2. Inspect the built document in the original CAD Viewer and export a GLB through its supported file actions or the model's declared exports.
3. Switch the Viewer to Vector Studio and choose **Import GLB**. This browser action creates a local editable polygon asset; current MCP tools do not perform it for the agent.

The importer renders triangles in orthographic isometric projection. It is an **illustration adapter**, not an exact CAD hidden-line drawing; hidden-face sorting, mesh topology, edge visibility, source part identity and units require review.

## Vector Studio handoff
Import the resulting SVG in Vector Studio (Library > Import SVG assets). Set its drawn size/rotation, layer it with original components, and save an editable JSON project and vector SVG export.

## Validation
Compare 3D and 2D views by fixed reference poses, confirm faces and orientations, and inspect projections for depth sorting errors. Keep dimensions and native engineering STEP/DXF views in CAD, rather than deriving precise dimensions from a stylized SVG.

---
name: cad-to-isometric-svg
description: Generate editable orthographic-isometric SVG illustrations from CAD-generated GLB files, using the unified vector workspace.
---
# CAD-to-isometric SVG

Generate CAD normally through text-to-cad (do not bypass its existing engine, models, export service, or CAD viewer). Request a GLB export, then use the optional offline geometry projection adapter.

## Typical sequence
\`\`\`bash
cad viewer path/to/model.py
# Export a GLB from the original text-to-cad UI or the model script.
python3 scripts/vector/glb_to_svg.py model.glb -o model-isometric.svg
\`\`\`

The script renders triangles in orthographic isometric projection. It is an **illustration adapter**, not an exact CAD hidden-line drawing; hidden-face sorting, mesh topology, edge visibility, source part identity and units require review.

## Vector Studio handoff
Import the resulting SVG in Vector Studio (Library > Import SVG assets). Set its drawn size/rotation, layer it with original components, and save an editable JSON project and vector SVG export.

## Validation
Compare 3D and 2D views by fixed reference poses, confirm faces and orientations, and inspect projections for depth sorting errors. Keep dimensions and native engineering STEP/DXF views in CAD, rather than deriving precise dimensions from a stylized SVG.

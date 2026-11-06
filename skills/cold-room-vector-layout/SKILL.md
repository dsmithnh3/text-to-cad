---
name: cold-room-vector-layout
description: Compose editable isometric cold-room/facility layouts from structured equipment and room components inside Vector Studio.
metadata:
  repository: earthtojake/text-to-cad
---
# Cold-room vector layouts

Use text-to-cad's existing CAD workflow for engineered solids and separately use Vector Studio for drawings/arrangements. The two modes must remain independent.

1. Identify available room, wall, floor, roof, door, curtain, rack, evaporator, CDU, condenser, pipe and loading dock assets.
2. Respect explicit dimensions; treat SVG scene coordinates as display units until a calibrated scale is provided.
3. Assemble a native vector project using the versioned \`cad-vector-studio/v1\` JSON structure, local library assets, and/or immutable catalog revisions (`vector_catalog_get` / `list` by \`revisionId\`). Stay within project budgets documented in \`docs/unified-cad-vector-studio.md\`.
4. Preserve layers and component provenance. Prefer durable \`vector_project_*\` revisions (with \`expectedRevision\` on update); client drafts are a recoverable overlay. Use JSON project for editing and consolidated SVG for drawings.
5. Validate component stacking, clearance, room opening alignment, orientation and fittings. Engineering calculations and code compliance remain separate.
6. Never silently substitute a door-opening overlay or UI icon for a complete equipment model; flag missing reference geometry.

Local-only SupaCAD-derived reference assets are not included in the public fork. Import them separately and verify licensing before distribution.

---
name: refrigeration-equipment
description: Produce industrial refrigeration equipment geometry with text-to-cad and corresponding editable Vector Studio assets, using dimensional evidence.
metadata:
  repository: earthtojake/text-to-cad
---
# Industrial refrigeration equipment

Use the installed text-to-cad CAD skill to generate parametric engineering geometry (Python/build123d) and its existing CAD viewer, XBF/STEP/GLB export pipeline. Do not create a second CAD engine.

## Input
Equipment family; actual envelope dimensions and units; arrangement; fan count and diameter; connection positions, pipe sizes, orientation, material; reference model or SVG where available.

## Workflow
1. Read the CAD skill and derive named components: cabinet, frame, coil placeholder, fan guards, manifold, connections and mounts. Preserve physically plausible clearances.
2. If dimensional inputs are missing, explicitly mark them as assumptions. Do not invent a certified manufacturer model or performance rating.
3. Author and build the Python model using installed text-to-cad; review the part tree and STEP/GLB output in the original CAD viewer. Keep parameter definitions separate from geometry.
4. Convert an exported GLB to **experimental** editable isometric SVG with the script in this fork, or use the original CAD export for engineering deliverables. Preserve the source model and provenance.
5. Import the SVG into Vector Studio. Visually compare orientation, scale, connectivity, and major envelopes against the source model and references.
6. Store family, actual dimensions, connection metadata, units, provenance and validation status as structured project metadata.

## Families
Ceiling/wall evaporators; air-cooled and evaporative condensers; compressor skids; recirculators, vessels; CDU units; valves and pipe supports. An illustrative SVG must not be mistaken for certified refrigeration design or code compliance.

## Acceptance
Source CAD opens independently. STEP/GLB export remains valid. SVG opens independently and preserves editable paths. Labels and attachment points correspond to the source geometry. Never claim an approximate vector projection is exact CAD geometry.

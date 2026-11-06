# Unified CAD + Vector Studio — development feature

This is an additive feature to **text-to-cad**, not a separate CAD engine or a replacement UI.

## Reused without modification
- Original Python/build123d/Open CASCADE CAD generation and model lifecycle
- XBF, STEP, GLB, STL, 3MF and DXF export machinery
- Engine daemon, MCP shim, CAD viewer, document registry, model library, file explorer
- Viewer host permissions/session, authentication, navigation, update and theme settings
- \`@cad/ui\` shared Button primitives and theme tokens; lucide icon system
- Plugin manifests and existing CAD/engineering-drawing/DXF skills

## Two independent workflows

### CAD only (unchanged)
Run \`cad viewer\` or the current text-to-cad agent workflow. The CAD tab is the existing \`CadViewer\`, mounts as before, and never depends on Vector Studio. Its model selection, status and engine are not overwritten when Vector Studio opens.

### Vector Studio
Use the new **Vector Studio** tab. Add locally held SVG assets from the Library, import multiple SVG files, drag/resize/rotate, reorder layers, save or load JSON, export combined editable SVG. Undo/redo are scoped to the vector project. No CAD build occurs merely by editing SVGs.

### CAD -> Vector
1. Generate a model with the original CAD skill and build123d.
2. Export GLB using the normal CAD export service.
3. Switch to Vector Studio and use **Import GLB** (experimental, approximation of mesh surfaces).
4. Compose and export the resulting editable polygon asset. Do **not** treat projected SVG as a precision manufacturing drawing.
5. Use CAD's engineering-drawing and DXF skills, not Vector Studio, when dimensioned production output is required.

## Local source-derived library (not public repo)
The SupaCAD-derived extracted artwork is third-party material with separate rights. This branch contains no such graphics. To import an archive the user already possesses:

\`\`\`bash
python3 scripts/vector/import_svg_library.py "/path/to/SupaCAD_Modular_SVG_Components_Library.zip"
npm ci
npm run build:web
\`\`\`

The importer writes the SVG files into \`apps/web/src/vector/assets/\`, intentionally Git-ignored. Vite's native \`import.meta.glob\` compiles them into the vector workspace. If you are adding many large assets, rebuild time and bundle size will increase; consider asset-server streaming and search indexing in a future iteration.

## Setup and local testing
- Follow root \`AGENTS.md\` and \`CONTRIBUTING.md\`.
- Dev install requires the upstream CAD Python environment and engine (do not attempt to start a second engine).
- \`npm ci && npm run build:packages && npm run typecheck -w @cad/web && npm run build -w @cad/web\`
- Test CAD-only behavior first. Change workspaces while viewing a CAD document, return to CAD, and confirm the original file and engine state persist.
- Test vector JSON/SVG export/import round trips; compare scene rendering and SVG ID uniqueness.

## Current implementation scope
| Function | Status |
| --- | --- |
| Shared CAD page retained | Implemented in host |
| CAD / Vector switch | Implemented |
| Token-driven shared styling and controls | Implemented |
| SVG library and import | Implemented (local SVG files) |
| SVG scene composition and editable export | Implemented |
| Layers, ordering, selection, transforms | Implemented |
| JSON project save/load, undo/redo | Implemented |
| Experimental GLB->SVG | Native browser import; illustrative mesh projection |
| True CAD->SVG feature topology and hidden-line projection | Not implemented |
| Shared assembly graph / parametric round-trip | Not implemented |
| Server-side vector project database | Not implemented |
| Per-instance raw SVG source editing | Implemented |
| Structured SVG path/node editing | Not implemented |
| Vector MCP tools and agent-controlled project editing | Not implemented |
| Full parity with prior 12MB offline Vector Studio prototype | Not claimed |
| Manufacturer-certified equipment / compliant piping sizing | Not implemented |

**Security:** Imported SVG drops active elements, CSS, event handlers, external resources, and undeclared fragment references. GLB projection accepts only self-contained embedded resources. External assets should still be regarded as untrusted, and project/archive aggregate budgets remain planned hardening. Local asset importer is intended for your own trusted extraction. Never embed session tokens in vector JSON exports.

**Fork state:** This implementation started from the fork's main branch (0.10.3) and was reconciled with upstream 0.10.4 during M0. Do not update upstream release pins manually; rerun the selected CI and packaged browser checks before merging or release.

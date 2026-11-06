# Unified CAD + Vector Studio — development feature

This is an additive feature to **text-to-cad**, not a separate CAD engine or a replacement UI.

## Reused without modification
- Original Python/build123d/Open CASCADE CAD generation and model lifecycle
- XBF, STEP, GLB, STL, 3MF and DXF export machinery
- Engine daemon, MCP shim, CAD viewer, document registry, model library, file explorer
- Viewer host permissions/session, authentication, navigation, update and theme settings
- `@cad/ui` shared Button primitives and theme tokens; lucide icon system
- Plugin manifests and existing CAD/engineering-drawing/DXF skills

## Two independent workflows

### CAD only (unchanged)
Run `cad viewer` or the current text-to-cad agent workflow. The CAD tab is the existing `CadViewer`, mounts as before, and never depends on Vector Studio. Its model selection, status and engine are not overwritten when Vector Studio opens.

### Vector Studio
Use the **Vector Studio** tab (CAD Viewer) or the MCP `VectorView` (CAD app / embedded Codex snapshot). Add SVG assets from the Library or catalog revisions, import SVG files, drag/resize/rotate, reorder layers, edit structured SVG nodes when editable, save or load JSON, and export combined editable SVG. Undo/redo are scoped to the vector project. Client drafts recover over durable server revisions. No CAD build occurs merely by editing SVGs.

### CAD → Vector
1. Generate a model with the original CAD skill and build123d.
2. Prefer **CAD-accurate** orthographic or isometric projection via `/api/v1/vector/projections` or MCP `vector_projection_publish` (STEP/XBF path + view). Provenance-backed regeneration uses `vector_projection_regenerate` when `expectedRevision` matches the lineage tip and `source.path` is present.
3. Optionally use **Import GLB** in the browser for an **illustrative** mesh polygon asset. Do **not** treat mesh-projected SVG as a precision manufacturing drawing.
4. Compose and export editable SVG in Vector Studio.
5. Use CAD's engineering-drawing and DXF skills, not Vector Studio, when dimensioned production output is required.

## Local source-derived library (not public repo)
The SupaCAD-derived extracted artwork is third-party material with separate rights. This branch contains no such graphics. To import an archive the user already possesses:

```bash
python3 scripts/vector/import_svg_library.py "/path/to/SupaCAD_Modular_SVG_Components_Library.zip"
npm ci
npm run build:web
```

The importer writes the SVG files into `apps/web/src/vector/assets/`, intentionally Git-ignored. Vite's native `import.meta.glob` compiles them into the vector workspace. The importer inspects the ZIP central directory and streams only selected members under archive budgets (`MAX_FILES = 2000`, `MAX_FILE = 2_000_000`, `MAX_TOTAL = 80_000_000`). If you are adding many large assets, rebuild time and bundle size will increase; consider asset-server streaming and search indexing in a future iteration.

## Setup and local testing
- Follow root `AGENTS.md` and `CONTRIBUTING.md`.
- Dev install requires the upstream CAD Python environment and engine (do not attempt to start a second engine).
- `npm ci && npm run build:packages && npm run typecheck -w @cad/web && npm run build -w @cad/web`
- Test CAD-only behavior first. Change workspaces while viewing a CAD document, return to CAD, and confirm the original file and engine state persist.
- Test vector JSON/SVG export/import round trips; compare scene rendering and SVG ID uniqueness.
- Embedded Codex uses a built plugin snapshot (`scripts/install/dev_install.py codex`); browser Vite remains the HMR loop.

## Current implementation scope
| Function | Status |
| --- | --- |
| Shared CAD page retained | Implemented in host |
| CAD / Vector switch | Implemented (Viewer + MCP `VectorView`) |
| Token-driven shared styling and controls | Implemented |
| SVG library and import | Implemented (local SVG files + catalog revisions) |
| SVG scene composition and editable export | Implemented |
| Layers, ordering, selection, transforms | Implemented |
| JSON project save/load, undo/redo | Implemented (one undo transaction per user action) |
| Draft persistence with quota failures | Implemented (recoverable overlay over durable revisions) |
| Project / archive aggregate budgets | Implemented (exact limits below) |
| Experimental GLB→SVG | Native browser import; illustrative mesh projection (labeled) |
| CAD-accurate projection + regeneration | Orthographic + isometric OCCT HLR; immutable asset revisions; `vector_projection_*` |
| Shared assembly graph / parametric round-trip | Not implemented |
| Server-side vector project database | Durable UUID/revision store (`/api/v1/vector/projects`); client drafts remain overlay |
| Immutable component catalog | Publish-once revisions under `/api/v1/vector/catalog`; MCP/UI consume by revision id |
| Per-instance raw SVG source editing | Implemented |
| Structured SVG path/node editing | Implemented (editable AST + controls; opaque subtrees lossless) |
| Vector MCP tools and agent-controlled project editing | Implemented (`vector_project_*`, `vector_catalog_*`, `vector_projection_*`; `expectedRevision` on mutation) |
| Shared `@cad/ui/vector` + MCP `VectorView` | Implemented (embedded Codex snapshot; browser Vite HMR) |
| Full parity with prior 12MB offline Vector Studio prototype | Not claimed |
| Manufacturer-certified equipment / compliant piping sizing | Not implemented |

## Security and budgets
Imported SVG is sanitized before commit: active elements (`script`, `style`, `foreignObject`, media/embeds, SMIL animation), inline `style`, event handlers, `javascript:`/`data:` URLs, and undeclared fragment / external resource references are dropped or rejected. Individual SVG assets are capped at 2 MB. GLB projection accepts only self-contained embedded resources.

Project JSON is rejected before write when it exceeds aggregate budgets (exact; tests pin limit and limit+1):

| Budget | Limit |
| --- | --- |
| `MAX_PROJECT_BYTES` | 8_000_000 |
| `MAX_ASSET_COUNT` | 500 |
| `MAX_ITEM_COUNT` | 2_000 |
| `MAX_AGGREGATE_SVG_BYTES` | 6_000_000 |
| `MAX_DIMENSION` | 100_000 |
| Finite transforms | `x`, `y`, `w`, `h`, `rotate`, `opacity`; `w`/`h` > 0 |

Draft restore surfaces storage-quota and unavailable-storage failures; over-budget drafts are rejected at the adapter boundary. Never embed session tokens in vector JSON exports. Local asset importer is intended for your own trusted extraction.

## MCP truthfulness
Agents may use only the catalogued Vector tools:

- `vector_project_create` / `get` / `update` (durable UUID/revision; `expectedRevision` required on update)
- `vector_catalog_publish` / `get` / `list` (immutable revisions; look up by `revisionId`)
- `vector_projection_publish` / `get` / `list` / `regenerate` (CAD-accurate only; regenerate needs `expectedRevision` and path-backed provenance)

Not MCP-driven today: browser **Import GLB** (illustrative mesh), Viewer file-picker SVG import, and any claim of parametric CAD↔vector round-trip or certified equipment sizing. Do not advertise agent control the tool catalog cannot perform.

## Known limitations
- Document-id-only projection provenance cannot regenerate yet; `vector_projection_regenerate` requires `provenance.source.path` (STEP/XBF). Path-backed exports regenerate normally.
- Illustrative GLB mesh projection remains distinct from CAD-accurate HLR and must stay labeled.
- Projected SVG is not a substitute for engineering-drawing / DXF deliverables.

## Fork state
This implementation started from the fork's main branch (0.10.3) and was reconciled with upstream 0.10.4 during M0. Do not update upstream release pins manually; rerun the selected CI and packaged browser checks before merging or release. Push and publish remain authorization-gated.

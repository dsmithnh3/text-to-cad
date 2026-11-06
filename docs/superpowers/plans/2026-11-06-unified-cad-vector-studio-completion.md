# Unified CAD + Vector Studio Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Recovery note:** Original plan commits `d654430f` / `08cdcc2b` lived only in a Codex
> cloud workspace and were never pushed. Exact file text was not preserved locally. This
> plan reconstructs the approved 14-task / 7-milestone program from transcript summaries,
> the SDD dependency ledger, the embedded Codex gate, and M0 Tasks 4–5 (which map to
> completion Tasks 1–2).

**Goal:** Complete Unified CAD + Vector Studio as a staged full-scope program: merge-ready
hardening first, then shared contracts, durable storage, Vector MCP/shared UI (with embedded
Codex testing), structured SVG editing, CAD-accurate projection, and release gates.

**Architecture:** Keep `CadViewer`, the CAD engine, registry, exports, MCP shim, and plugin
host as the system of record. Vector Studio remains a workspace in the existing web host for
M0 (app-local modules under `apps/web/src/vector/`), then promotes contracts into `@cad/core`
and UI into `@cad/ui`. Server UUID/revision storage is authoritative; client drafts recover
over it. Imported SVG/GLB/JSON/ZIP stay untrusted and budgeted.

**Tech Stack:** React 19, TypeScript, Vite, `@cad/ui`, `@cad/core`, Three.js, Python 3.14,
build123d/Open CASCADE, Node test runner, JSDOM, existing shell/Python CI runners.

**Spec:** `docs/superpowers/specs/2026-11-06-unified-cad-vector-studio-completion-design.md`

## Global Constraints

- Preserve the original CAD-only workflow and keep `CadViewer` mounted across workspace switches.
- Reuse existing text-to-cad UI, document, registry, export, MCP, localization, and CI systems.
- Treat imported SVG, GLB, JSON, and ZIP content as untrusted and bounded.
- Keep illustrative mesh projection distinct from CAD-accurate geometry and drawings.
- Do not advertise agent control that the current MCP tool catalog cannot perform.
- Do not push or publish without explicit authorization; Task 4's planned push stays deferred
  under that standing rule.
- M0 modules stay app-local; promotion happens only in the shared-contract tasks.

## Milestone map

| Milestone | Tasks | Gate |
| --- | --- | --- |
| 0 Merge-critical | 1–4 | Budgets + history + drafts + browser coverage |
| 1 Shared contracts | 5–6 | TS/Python conformance fixtures |
| 2 Durable store + catalog | 7–8 | UUID/revision store; immutable catalog |
| 3 Vector MCP + shared UI | 9 | `@cad/ui` + MCP `VectorView` + embedded Codex |
| 4 Structured SVG | 10–11 | Editable AST + structured controls |
| 5 CAD projection | 12–13 | Orthographic/isometric + regeneration |
| 6 Polish + release | 14 | Perf/security/docs/packaging |

---

### Task 1: Bound project and archive ingestion

**Files:**
- Create: `apps/web/src/vector/vectorProject.ts`
- Create: `apps/web/src/vector/vectorProject.test.mjs`
- Modify: `apps/web/src/vector/VectorWorkspace.tsx`
- Modify: `scripts/vector/import_svg_library.py`
- Create: `tests/python/global/test_vector_import_library.py`
- Modify: `scripts/github-workflows/select_checks.py` (wire `scripts/vector/**` → the new policy test)

**Interfaces:**
- Consumes: existing `Project` / `Asset` / `Item` shapes in `VectorWorkspace.tsx`; ZIP importer limits.
- Produces: `parseVectorProject(text: string): Project` that rejects over-budget / non-finite
  input before commit; archive importer that inspects the central directory and streams only
  selected members (no `testzip()` full-member walk; irrelevant compressed members rejected
  without full-archive decompression).

**Budgets (exact; tests pin both limit and limit+1):**
- `MAX_PROJECT_BYTES = 8_000_000`
- `MAX_ASSET_COUNT = 500`
- `MAX_ITEM_COUNT = 2_000`
- `MAX_AGGREGATE_SVG_BYTES = 6_000_000` (UTF-8 byte length of all `asset.svg` strings; kept under `MAX_PROJECT_BYTES` so the aggregate check is reachable)
- `MAX_DIMENSION = 100_000` (project `width`/`height` and item `w`/`h`)
- Finite numeric transforms only (`x`, `y`, `w`, `h`, `rotate`, `opacity`; `w`/`h` > 0)
- Archive (existing, keep): `MAX_FILES = 2000`, `MAX_FILE = 2_000_000`, `MAX_TOTAL = 80_000_000`

- [x] **Step 1: Write the failing web tests** for exact-limit / over-limit project bytes, asset
  count, item count, aggregate SVG bytes, dimensions, and non-finite transforms.
- [x] **Step 2: Run** `npm --prefix apps/web test -- src/vector/vectorProject.test.mjs` and
  confirm RED.
- [x] **Step 3: Implement** `parseVectorProject` (+ exported types/constants) and route
  JSON open/load paths in `VectorWorkspace` through it; surface quota failures in the status
  message.
- [x] **Step 4: Write the failing Python ZIP tests** proving irrelevant compressed members are
  rejected without full-archive decompression, and that oversized selected members fail before
  unbounded reads.
- [x] **Step 5: Replace** `testzip()` with central-directory checks and streamed selected-member
  limits in `import_svg_library.py`; wire CI selection for the new policy test.
- [x] **Step 6: Run** focused web + `scripts/test/test-global.sh tests/python/global/test_vector_import_library.py`
  (+ selection contract if the selector changed) and confirm GREEN.
- [x] **Step 7: Commit** `feat(vector): bound project and archive ingestion`

---

### Task 2: Transactional undo/history

**Files:**
- Create: `apps/web/src/vector/vectorState.ts`
- Create: `apps/web/src/vector/vectorState.test.mjs`
- Modify: `apps/web/src/vector/VectorWorkspace.tsx`

**Interfaces:**
- Consumes: validated `Project` from Task 1 (`parseVectorProject` / exported types).
- Produces: one reducer state `{ project, past, future }` with one transaction per user action;
  GLB asset+instance insertion is a single transaction.

- [x] **Step 1: Write failing Strict Mode / reducer tests** for insert, drag commit, source
  edit, GLB asset+instance insertion, undo, and redo (no double-push under double-invoke).
- [x] **Step 2: Run** focused `vectorState` tests and confirm RED.
- [x] **Step 3: Replace** nested `useState` history updates with the reducer; keep drag preview
  ephemeral until pointer-up commits one transaction.
- [x] **Step 4: Run** focused web tests GREEN and commit `feat(vector): transactional undo history`

---

### Task 3: Draft persistence and restore

**Files:**
- Modify: `apps/web/src/vector/VectorWorkspace.tsx`
- Modify or create: host tab/session persistence adapter used after upstream reconciliation
- Create/extend: persistence tests beside `vectorState` / workspace tests

**Interfaces:**
- Consumes: reducer revisions from Task 2; Task 1 validation at the adapter boundary.
- Produces: versioned draft write/restore that reports storage-quota failures; only committed
  reducer revisions are persisted.

- [x] Add failing session-restore and storage-quota failure tests.
- [x] Route workspace/project persistence through the established versioned tab lifecycle or an
  explicit host adapter that reports write failure.
- [x] Run focused web tests; commit `feat(vector): persist drafts with quota failures`

---

### Task 4: Browser regression gate (PR #1)

**Files:**
- Modify tests only when a reproduced product defect requires a regression.

**Interfaces:**
- Produces: reviewable evidence for transform, source edit, save/load, export, CAD↔Vector
  switch, and SVG sanitization in a real browser—without claiming unrun checks.

- [x] Run `scripts/test/test-js.sh --select web`, relevant global policy tests, and the packaged
  Viewer/browser smoke with real Chromium; capture pass/fail evidence.
  - `test-js.sh --select web`: PASS (100 web tests) after localizing draft quota/unavailable
    messages that `check-ui-strings` refused as English object `message:` literals.
  - `test-global.sh tests/python/global/test_vector_import_library.py`: PASS (3/3).
  - `scripts/bundle/bundle.sh --check`: PASS.
  - `scripts/test/test-viewer-browser.sh` (real Chromium): PASS (format + camera).
- [x] Exercise transform, source edit, save/load, and export in a real browser.
  - One-off Chromium pass against Vite on `127.0.0.1:5174` (existing `:5173` left untouched):
    CAD↔Vector switch, insert, X transform, source edit with script/onload stripped (no XSS),
    export SVG, save/load JSON, draft restore after reload. Evidence under ignored
    `tmp/task4-vector-browser/evidence/` (not committed).
- [x] Record remaining limitations (no Vector MCP yet; projection still illustrative).
  - No Vector MCP tools / `VectorView` in `apps/mcp` yet (Task 9).
  - GLB→SVG projection remains illustrative mesh polygons, not CAD-accurate HLR.
  - No shared `@cad/core` project contract yet (Tasks 5–6); durable UUID/revision store and
    immutable catalog still ahead (Tasks 7–8).
  - Structured SVG AST / editor controls still ahead (Tasks 10–11).
- [x] **Do not push** unless explicitly authorized; local validation continues.
  - Push remains deferred under standing authorization; branch local-only for Task 4.

---

### Task 5: Shared TypeScript project contract

**Files:**
- Create: shared schema/types under `packages/core` (exact path chosen to match `@cad/core` laws)
- Create: language-neutral JSON fixtures
- Modify: `apps/web/src/vector/vectorProject.ts` to consume the shared contract (or re-export)

**Interfaces:**
- Consumes: Task 1 validation semantics.
- Produces: exported schema + fixtures that Python (Task 6) must conform to.

- [ ] Add failing conformance fixture tests in core/web.
- [ ] Extract schema/constants without changing M0 budgets.
- [ ] Run focused core + web tests; commit.

---

### Task 6: Python project parser conformance

**Files:**
- Create: `packages/cad/src/cad/vector_project.py` (`parse_vector_project`)
- Create: `tests/python/packages/cad/test_vector_project_conformance.py`
- Fixture (Task 5, unchanged): `packages/core/src/lib/vectorProject.conformance.json`
- Modify: CI selection if a new path kind is introduced (not required: `packages/cad/**` and
  `tests/python/packages/**` already select cadgen; `packages/core/**` already selects everything)

**Interfaces:**
- Consumes: JSON fixtures from Task 5.
- Produces: Python `parse_vector_project` (name exact in implementation) that rejects before write.

- [x] Add failing fixture-driven Python tests.
- [x] Implement parser; reject over-budget / non-finite input.
- [x] Run focused global/package tests; commit.

---

### Task 7: Durable UUID/revision project store

**Files:**
- Create: server-side store under `packages/cad-server` (viewer/API leaf per package README)
- Create: client adapter that talks expected-revision mutations
- Test: reject stale revision and invalid project before write

**Interfaces:**
- Consumes: Task 5/6 schema; Task 3 draft as recovery layer.
- Produces: server-authoritative UUID + revision documents; draft remains recoverable overlay.

- [x] Failing tests for create/update/get with expected revision.
- [x] Implement store + reject-before-write.
- [x] Focused Python + web tests; commit.

---

### Task 8: Immutable component catalog

**Files:**
- Create: catalog revision model (server + client read path)
- Test: catalog entries immutable once published; MCP/UI consume by revision id

**Interfaces:**
- Consumes: durable store (Task 7).
- Produces: immutable component revisions for MCP/UI (Task 9).

- [x] Failing immutability / lookup tests.
- [x] Implement catalog; commit.

---

### Task 9: Shared Vector UI, MCP tools, embedded Codex gate

**Files:**
- Move/reuse Vector surface into `packages/ui` per `packages/ui/README.md` / viewer-host contract
- Modify: `apps/mcp` to add `VectorView` and CAD/Vector switching
- Modify: MCP tool catalog for typed Vector commands (expected revision on mutation)
- Reinstall: `scripts/install/dev_install.py codex` after build

**Interfaces:**
- Consumes: Tasks 7–8 store/catalog; shared UI laws (injected browser effects).
- Produces: embedded Codex-capable Vector workspace + MCP tools.

**Embedded Codex gate (required):**
- [x] Extract reusable Vector interface into `@cad/ui`.
- [x] Integrate into `apps/mcp` with `VectorView` and workspace switch.
- [x] Expose Vector MCP tools; prove via `tools/list` + mutation tests.
- [x] Reinstall the development plugin; open a **fresh** Codex chat; verify CAD/Vector switching.
- [x] Confirm embedded path is snapshot-based (no hot reload); browser Vite remains HMR.
- [x] Commit after local evidence; do not push unless authorized.

---

### Task 10: Structured SVG AST

**Files:**
- Create: SVG AST module (editable vs opaque nodes)
- Extend: schema/commands for AST-preserving round-trip
- Test: opaque subtrees survive lossless; editable nodes round-trip

**Interfaces:**
- Consumes: sanitized SVG boundary from M0 `svgSafety`.
- Produces: AST consumed by Task 11 controls; v1 commands remain backward compatible.

- [ ] Failing AST/opaque tests.
- [ ] Implement AST; commit.

---

### Task 11: Structured SVG editor controls

**Files:**
- Extend: shared Vector UI editor (style location builder-owned under shared-UI laws)
- Test: structured edits update AST; opaque nodes not silently rewritten

**Interfaces:**
- Consumes: Task 10 AST.
- Produces: structured controls in the shared Vector surface.

- [ ] Failing control tests.
- [ ] Implement controls; focused UI/web/mcp tests; commit.

---

### Task 12: CAD-accurate projection export

**Files:**
- Extend: projection pipeline (orthographic + isometric) with provenance asset revision
- Keep: illustrative GLB mesh path distinct and labeled

**Interfaces:**
- Consumes: CAD export/document APIs; Task 7 asset revisions.
- Produces: projection export consumed by Task 13 regeneration.

- [ ] Failing provenance / view tests.
- [ ] Implement orthographic + isometric export path; commit.

---

### Task 13: Projection regeneration

**Files:**
- Extend: MCP/server operations to regenerate projection assets from provenance
- Test: regeneration creates a new immutable asset revision; expected revision enforced

**Interfaces:**
- Consumes: Task 12 projection export; Task 9 MCP operations.
- Produces: regeneration command path.

- [ ] Failing regeneration tests.
- [ ] Implement; focused tests; commit.

---

### Task 14: Performance, recovery, security, documentation, release

**Files:**
- Update: `docs/unified-cad-vector-studio.md`, skill guidance as needed
- Modify: packaging/docs only when behavior changes require it
- Run: `scripts/bundle/bundle.sh --check`, focused JS/Python suites, browser smoke

**Interfaces:**
- Produces: release-ready evidence; final embedded Codex gate still green if Task 9 code moved.

- [ ] Perf/recovery checks for large-but-in-budget projects.
- [ ] Security docs reflect budgets + sanitization + MCP truthfulness.
- [ ] Packaging and docs site copy stay in step with README laws.
- [ ] Final completion checklist: Milestones 0–6 gates, including embedded Codex.

---

## Parallelism notes

Safe after contracts stabilize: Tasks 10–11 (SVG) can proceed beside 12–13 (projection) once
Task 9’s shared surface exists. Do not parallelize Task 1 with Task 2 until Task 1 types are
exported. Task 4 push remains authorization-gated.

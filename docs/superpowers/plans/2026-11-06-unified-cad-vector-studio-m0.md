# Unified CAD + Vector Studio M0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PR #1 safe to continue by reconciling upstream 0.10.4, restoring CI, closing critical import boundaries, and establishing executable regression coverage.

**Architecture:** Keep `CadViewer`, the CAD engine, registry, exports, MCP server, and plugin host unchanged as the system of record. Vector Studio remains a workspace in the existing web host, with pure/tested SVG and GLB ingestion boundaries; later milestones move project/history state behind the established tab/document lifecycle rather than adding another registry.

**Tech Stack:** React 19, TypeScript, Vite, `@cad/ui`, Three.js, Python 3.14, build123d/Open CASCADE, Node test runner, JSDOM, existing shell/Python CI runners.

**Spec:** `docs/unified-cad-vector-studio.md` plus the Unified CAD + Vector Studio mission supplied for PR #1.

## Global Constraints

- Preserve the original CAD-only workflow and keep `CadViewer` mounted across workspace switches.
- Reuse existing text-to-cad UI, document, registry, export, MCP, localization, and CI systems.
- Treat imported SVG, GLB, JSON, and ZIP content as untrusted and bounded.
- Keep illustrative mesh projection distinct from CAD-accurate geometry and drawings.
- Do not advertise agent control that the current MCP tool catalog cannot perform.
- Keep tracked source and user work intact while reconciling upstream.

## Review Focus

- SVG CSS, event handlers, remote resources, and host-fragment references must not affect the authenticated host page; `svgSafety.test.mjs` owns this boundary.
- GLB URI dependencies must never make same-origin or remote requests; `glbProjection.test.mjs` owns this boundary.
- CAD engine loss must block CAD while leaving the client-only Vector workspace usable; `App.test.mjs` owns this behavior.
- Large/corrupt projects and asset batches must fail before unbounded parse/render work; Task 4 adds exact aggregate-budget tests.
- Undo/redo must record one transaction under React Strict Mode, including GLB asset+instance insertion; Task 5 adds reducer tests.

---

### Task 1: Baseline, independent review, and upstream reconciliation

**Files:**
- Create: `docs/superpowers/plans/2026-11-06-unified-cad-vector-studio-m0.md`
- Modify only conflict resolutions in files changed by both `upstream/main` and PR #1.

**Interfaces:**
- Consumes: `upstream/main` at release 0.10.4 and PR #1 head.
- Produces: feature branch containing upstream 0.10.4 with custom behavior retained.

- [x] Fetch PR #1, fork main, and upstream main; record exact revisions and merge base.
- [x] Run independent architecture, frontend, SVG/security, MCP/skills, and QA reviews.
- [ ] Merge `upstream/main`, resolve conflicts by preserving upstream contracts and tested Vector behavior, then run `scripts/release/sync-version.mjs --check`.
- [ ] Commit the reconciliation separately from functional fixes.

### Task 2: Restore web CI and independent workspace behavior

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.mjs`
- Modify: `apps/web/src/vector/VectorWorkspace.tsx`
- Modify: `apps/web/src/vector/glbProjection.ts`

**Interfaces:**
- Consumes: existing `CadViewer`, engine reconnect state, and workspace selection.
- Produces: type-correct web host where CAD outage state applies only to CAD mode.

- [x] Reproduce the TypeScript and existing App-test failures.
- [x] Add the engine-down Vector regression assertion and verify it fails.
- [x] Fix event typing, non-Vite catalog loading, and CAD-only outage scoping.
- [x] Run web typecheck and the complete web test suite.

### Task 3: Secure SVG and GLB ingestion

**Files:**
- Create: `apps/web/src/vector/svgSafety.ts`
- Create: `apps/web/src/vector/svgSafety.test.mjs`
- Create: `apps/web/src/vector/glbProjection.test.mjs`
- Modify: `apps/web/src/vector/VectorWorkspace.tsx`
- Modify: `apps/web/src/vector/glbProjection.ts`

**Interfaces:**
- Produces: `sanitizeSvg(input: string): string`, `isolateSvg(xml: string, suffix: string): string`, and `createProjectionLoadingManager(): LoadingManager`.

- [x] Add failing tests for global CSS, active content, external references, safe local fragments, per-instance ID rewriting, and external GLB dependencies.
- [x] Remove SVG style elements/attributes, retain only declared local fragments, and rewrite surviving references per instance.
- [x] Reject non-embedded GLB dependencies before the loader can fetch them.
- [x] Run focused security tests, typecheck, and full web tests.

### Task 4: Bound project, archive, and render work

**Files:**
- Modify: `apps/web/src/vector/VectorWorkspace.tsx`
- Create: `apps/web/src/vector/vectorProject.ts`
- Create: `apps/web/src/vector/vectorProject.test.mjs`
- Modify: `scripts/vector/import_svg_library.py`
- Create: `tests/python/global/test_vector_import_library.py`

**Interfaces:**
- Produces: validated `parseVectorProject(text: string) -> Project` with finite dimensions/transforms and aggregate budgets.

- [ ] Add failing exact-limit/over-limit tests for file bytes, asset count, item count, aggregate SVG bytes, dimensions, and non-finite transforms.
- [ ] Validate project structure before committing it and surface quota/persistence failures.
- [ ] Add a ZIP fixture proving irrelevant compressed members are rejected without full-archive decompression.
- [ ] Replace `testzip()` with central-directory and streamed selected-member limits.

### Task 5: Make editing history transactional and persistent

**Files:**
- Create: `apps/web/src/vector/vectorState.ts`
- Create: `apps/web/src/vector/vectorState.test.mjs`
- Modify: `apps/web/src/vector/VectorWorkspace.tsx`
- Modify: the existing tab persistence adapter selected after upstream reconciliation.

**Interfaces:**
- Produces: one reducer state containing `project`, `past`, and `future`, with one transaction per user action.

- [ ] Add failing Strict Mode tests for insert, drag, source edit, GLB asset+instance insertion, undo, and redo.
- [ ] Replace nested React state updates with reducer transactions.
- [ ] Route workspace/project persistence through the established versioned tab lifecycle or an explicit host adapter that reports write failure.
- [ ] Add session restore and storage-quota failure tests.

### Task 6: Make shipped skill guidance truthful and executable

**Files:**
- Modify: `skills/cad-to-isometric-svg/SKILL.md`
- Modify: `skills/refrigeration-equipment/SKILL.md`
- Create: `tests/python/global/test_vector_skill_distribution.py`

**Interfaces:**
- Produces: installed guidance that uses shipped CAD/UI capabilities and clearly identifies browser-only handoffs.

- [x] Add a failing test for checkout-only script references and invalid `cad viewer *.py` instructions.
- [x] Replace those instructions with the supported model-build, GLB-export, and Vector import flow.
- [ ] Keep future MCP work in a focused M4 plan; do not claim Vector tools exist until `tools/list` and end-to-end mutation tests prove it.

### Task 7: Browser, packaging, and CAD regression gate

**Files:**
- Modify tests only when a reproduced product defect requires a regression.

**Interfaces:**
- Produces: reviewable evidence for PR readiness, without claiming unrun checks.

- [ ] Run `scripts/test/test-js.sh --select web`, relevant global policy tests, `scripts/bundle/bundle.sh --check`, and selected Python package tests.
- [ ] Run the packaged Viewer/browser smoke with real Chromium and capture actual pass/fail evidence.
- [ ] Exercise SVG import, transform, source edit, save/load, export, workspace switching, and CAD document preservation in a real browser.
- [ ] Record remaining limitations: no Vector MCP tools, no unified component registry, projection is illustrative, and advanced editing remains future work.

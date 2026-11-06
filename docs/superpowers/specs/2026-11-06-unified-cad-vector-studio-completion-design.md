# Unified CAD + Vector Studio Completion Design

> **Recovery note:** The original design was approved and committed only in a Codex cloud
> workspace (`1a0494af`, then `08cdcc2b` for the embedded Codex gate) and was never pushed.
> Exact Write-tool payloads were not preserved in local transcripts. This document
> reconstructs the approved design from the staged-full-scope decision, builder-review
> resolutions, milestone summary, Task 9 embedded-Codex gate, and the checked-in M0 plan.

**Date:** 2026-11-06  
**Status:** Approved (staged full scope)  
**Branch:** `feat/unified-cad-vector-studio`  
**Product doc:** `docs/unified-cad-vector-studio.md`  
**Prior plan:** `docs/superpowers/plans/2026-11-06-unified-cad-vector-studio-m0.md`

## Goal

Finish Unified CAD + Vector Studio as a staged, reviewable program: make PR #1 merge-ready
with bounded imports, transactional history, durable drafts, and browser regression; then
deliver shared contracts, server-backed projects, Vector MCP + shared UI (including embedded
Codex), structured SVG editing, CAD-accurate projection, and release gates—without breaking
the existing CAD-only workflow.

## Non-goals

- Parametric CAD↔vector round-trip and certified equipment/piping sizing (research-scale).
- Replacing `CadViewer`, the CAD engine, registry, exports, or plugin host.
- Advertising Vector MCP tools before `tools/list` and mutation tests prove them.
- Automatic watch-and-reinstall of the Codex development plugin (snapshots only).
- Treating projected mesh SVG as a precision manufacturing drawing.

## Architecture decisions (builder-review resolutions)

1. **Shared JSON contracts.** Project/schema shapes are language-neutral JSON with
   TypeScript and Python conformance fixtures. Fixtures are the authority; parsers reject
   before write.
2. **Shared Vector UI.** Reusable Vector surface extracts to `@cad/ui`; `apps/web` and
   `apps/mcp` host it. Browser effects stay injected; apps never import each other.
3. **Persistence.** Server-authoritative UUID/revision storage is the durable source of
   truth; client drafts remain a recoverable layer over server revisions.
4. **Extraction staging.** M0 keeps modules app-local under `apps/web/src/vector/`; M1
   promotes contracts into `@cad/core` after conformance fixtures exist.
5. **MCP.** Typed Vector commands only; expected revision required on mutation; catalog
   components are immutable revisions.
6. **CAD projection.** Orthographic plus isometric projections; provenance creates an
   immutable asset revision; illustrative mesh projection stays distinct from CAD-accurate
   paths.
7. **SVG editing boundary.** Explicit editable-versus-opaque nodes: structured editors
   mutate editable AST; opaque subtrees stay lossless through import/export.

## Milestones

| # | Name | Outcome |
| --- | --- | --- |
| 0 | Merge-critical hardening | Bounded project/archive ingestion, transactional undo, draft persistence, browser coverage for PR #1 |
| 1 | Shared contracts | TypeScript/Python project schema + conformance fixtures; promote parsers out of app-local modules |
| 2 | Durable store + catalog | Server UUID/revision project store; immutable component catalog |
| 3 | Vector MCP + shared UI | `@cad/ui` Vector surface, `apps/mcp` `VectorView`, typed MCP tools, **embedded Codex install + fresh-chat gate** |
| 4 | Structured SVG editing | SVG AST + structured controls; opaque nodes remain lossless |
| 5 | CAD-accurate projection | Orthographic/isometric projection export and regeneration with provenance |
| 6 | Polish + release | Performance, recovery, security docs, packaging, and release gates |

## Completion gates

- **PR #1 merge gate (Milestone 0):** exact aggregate budgets; one undo transaction per user
  action under Strict Mode (including GLB asset+instance); restore/quota failures surfaced;
  browser smoke covering transform, source edit, save/load, export, and CAD↔Vector switch.
- **Embedded Codex gate (Task 9 + final):** reusable Vector UI in `@cad/ui`, `apps/mcp`
  gains `VectorView`, Vector MCP tools exposed, development plugin reinstalled via
  `scripts/install/dev_install.py codex`, and CAD/Vector switching verified inside a fresh
  Codex chat. The embedded plugin is a built snapshot (no hot reload); browser Vite remains
  the HMR loop.
- **Final release gate:** packaging/`bundle.sh --check`, focused JS/Python suites green,
  skill guidance truthful, no claimed MCP/agent control the catalog cannot perform.

## Global constraints

- Preserve CAD-only workflow; keep `CadViewer` mounted across workspace switches.
- Reuse existing UI, document, registry, export, MCP, localization, and CI systems.
- Treat imported SVG, GLB, JSON, and ZIP content as untrusted and bounded.
- Keep illustrative mesh projection distinct from CAD-accurate geometry and drawings.
- Ships-alone law for published packages; Vector M0 code stays in `apps/web` until
  promotion tasks move contracts deliberately.
- Do not push, publish, or change cloud environment configuration without explicit
  authorization.

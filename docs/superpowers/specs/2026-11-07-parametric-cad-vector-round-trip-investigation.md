# Investigation: Parametric CAD ↔ Vector round-trip

**Date:** 2026-11-07  
**Status:** Investigation complete (not scheduled for implementation)  
**Fork:** `dsmithnh3/text-to-cad`  
**Related:** `docs/unified-cad-vector-studio.md`, completion design 2026-11-06

## Question

What would it take to keep Vector Studio compositions in sync with parametric CAD models (two-way or one-way), and should that work start now?

## Findings

### Already productized (one-way CAD → Vector)

| Capability | Mechanism |
| --- | --- |
| CAD-accurate SVG | OCCT HLR via `cad.cad_projection` / `vector_projection_*` |
| Provenance | `source.path`, `source.documentId`, `source.documentRevision` on projection revisions |
| Regenerate | `vector_projection_regenerate` when tip matches; path-backed or held document-id |
| Viewer publish | File ⋯ → Publish CAD projection → Library |

This is **regeneration from CAD**, not parametric binding of Vector edits back into build123d parameters.

### Explicit non-goals (still correct)

Unified CAD + Vector Studio completion design and product doc mark **parametric CAD↔vector round-trip** and certified equipment/piping sizing as out of scope. MCP truthfulness forbids advertising agent control the catalog cannot perform.

### Schema gap

- Projection revisions carry CAD provenance.
- Vector **project** assets only allow provenance `user-import` | `source-derived`.
- Placing a projection into a scene does **not** copy `documentId` / path into project JSON; lineage remains in the projection store by `revisionId`.

So today: regenerate SVG from CAD works; “edit Vector → update CAD parameter” has no identity or API.

### Shared math vs product outputs

`cad_projection` reuses engineering-drawing HLR helpers (`VIEW_DIRECTIONS`, `_Projection`, …). Shop PDFs and cut DXF remain separate skills (`engineering-drawing`, `dxf`) operating on the CAD model. That separation should stay even if round-trip is revisited.

## Options if reopened later

| Approach | Scope | Pros | Cons |
| --- | --- | --- | --- |
| **A. Provenance-on-place (recommended first)** | Extend project asset schema with optional CAD link (`documentId` / path / projectionRevisionId); regenerate button per item | Small; reuses existing regenerate | Still one-way |
| **B. Parameter map** | Named Vector controls ↔ model kwargs; rebuild CAD then reproject | True “parametric” UX | Research-scale; needs stable param API per model |
| **C. Bidirectional geometry** | Infer CAD edits from SVG node edits | Looks magical | Unsafe; breaks HLR/manufacturing trust |

**Recommendation:** Do **not** start B or C now. If product pressure appears, ship **A** first (link placed assets to projection/CAD source and expose Regenerate in Properties). Keep manufacturing via shop handoff prompts (implemented alongside this investigation), not via Vector SVG→PDF/DXF.

## Decision

- Parametric round-trip remains **deferred**.
- This investigation closes the “what would it take?” question with: reuse projection provenance; extend project schema only for one-way regenerate-on-place; do not claim two-way sync in MCP/docs until B has a concrete param contract.

## Follow-ups (optional, not in this PR’s product commits beyond docs)

1. Schema RFC for optional `cadLink` on `VectorAsset` + conformance fixtures.
2. Properties “Regenerate from CAD” when `cadLink` / projection revision is present.
3. Eval suite: change STEP → regenerate → scene SVG updates without losing transforms.

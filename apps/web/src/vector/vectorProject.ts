/**
 * App-facing re-export of the shared Vector Studio project contract in @cad/core.
 * Budgets and parse/validate semantics live in packages/core (vectorProject.conformance.json).
 */

export {
  MAX_AGGREGATE_SVG_BYTES,
  MAX_ASSET_COUNT,
  MAX_DIMENSION,
  MAX_ITEM_COUNT,
  MAX_PROJECT_BYTES,
  parseVectorProject,
  VectorProjectError,
} from '@cad/core/lib/vectorProject.js';

export type {
  VectorAsset,
  VectorItem,
  VectorProject,
  VectorProvenance,
} from '@cad/core/lib/vectorProject.js';

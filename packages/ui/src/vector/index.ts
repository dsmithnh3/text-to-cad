/**
 * `@cad/ui/vector`: shared Vector Studio surface for the web viewer and CAD app.
 * Hosts inject storage, project/catalog transports, and optional library assets;
 * shared UI never discovers browser globals for persistence or HTTP.
 */
export { default as VectorWorkspace } from './VectorWorkspace.js';
export type { VectorWorkspaceProps, VectorWorkspaceDocument } from './VectorWorkspace.js';

export {
  MAX_AGGREGATE_SVG_BYTES,
  MAX_ASSET_COUNT,
  MAX_DIMENSION,
  MAX_ITEM_COUNT,
  MAX_PROJECT_BYTES,
  parseVectorProject,
  VectorProjectError,
} from './vectorProject.js';
export type {
  VectorAsset,
  VectorItem,
  VectorProject,
  VectorProvenance,
} from './vectorProject.js';

export {
  VECTOR_DRAFT_KEY,
  VECTOR_DRAFT_VERSION,
  persistCommittedDraft,
  readVectorDraft,
  shouldPersistVectorDraft,
  writeVectorDraft,
} from './vectorDraft.js';
export type { VectorDraftStorage, VectorDraftWriteResult } from './vectorDraft.js';

export {
  MAX_HISTORY,
  createVectorState,
  reduceVectorState,
} from './vectorState.js';
export type { VectorEditorAction, VectorEditorState } from './vectorState.js';

export {
  VECTOR_PROJECTS_ROUTE,
  VectorProjectStoreClientError,
  createBrowserVectorProjectTransport,
  createVectorProject,
  getVectorProject,
  updateVectorProject,
} from './vectorProjectStore.js';
export type {
  VectorProjectDocument,
  VectorProjectStoreErrorCode,
  VectorProjectStoreResponse,
  VectorProjectStoreTransport,
} from './vectorProjectStore.js';

export {
  VECTOR_CATALOG_ROUTE,
  VectorCatalogClientError,
  createBrowserVectorCatalogTransport,
  getCatalogRevision,
  listCatalogRevisions,
  publishCatalogComponent,
} from './vectorCatalog.js';
export type {
  VectorCatalogComponentInput,
  VectorCatalogEntry,
  VectorCatalogErrorCode,
  VectorCatalogResponse,
  VectorCatalogTransport,
} from './vectorCatalog.js';

export { isolateSvg, sanitizeSvg } from './svgSafety.js';
export {
  EDITABLE_TAGS,
  applySvgAstCommand,
  editAssetSvg,
  parsePathCommands,
  parseSvgAst,
  serializePathCommands,
  serializeSvgAst,
} from './svgAst.js';
export type {
  SvgAst,
  SvgAstAttrs,
  SvgAstCommand,
  SvgAstNode,
  SvgEditableNode,
  SvgEditableTag,
  SvgOpaqueNode,
  SvgPathCommand,
} from './svgAst.js';
export {
  applyStructuredSvgEdit,
  collectOpaqueMarkups,
  findSvgAstNode,
  findSvgAstNodeById,
  listSvgAstEntries,
  patchStructuredAttrs,
  patchStructuredPathD,
  pathCommandsToD,
  structuredAttrsFor,
} from './svgStructuredControls.js';
export type {
  StructuredSvgEditResult,
  SvgAstListEntry,
} from './svgStructuredControls.js';
export { default as StructuredSvgControls } from './StructuredSvgControls.js';
export type { StructuredSvgControlsProps } from './StructuredSvgControls.js';
export { projectGLB } from './glbProjection.js';

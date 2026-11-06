/** Re-export structured SVG editor controls from `@cad/ui/vector`. */
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
  StructuredSvgControls,
} from '@cad/ui/vector';

export type {
  StructuredSvgEditResult,
  SvgAstListEntry,
  StructuredSvgControlsProps,
} from '@cad/ui/vector';

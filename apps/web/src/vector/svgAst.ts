/** Re-export structured SVG AST helpers from `@cad/ui/vector`. */
export {
  EDITABLE_TAGS,
  applySvgAstCommand,
  editAssetSvg,
  parsePathCommands,
  parseSvgAst,
  serializePathCommands,
  serializeSvgAst,
} from '@cad/ui/vector';

export type {
  SvgAst,
  SvgAstAttrs,
  SvgAstCommand,
  SvgAstNode,
  SvgEditableNode,
  SvgEditableTag,
  SvgOpaqueNode,
  SvgPathCommand,
} from '@cad/ui/vector';

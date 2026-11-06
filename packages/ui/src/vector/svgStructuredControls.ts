/**
 * Structured SVG editor controls for Vector Studio.
 *
 * Consumes Task 10's editable/opaque AST: controls mutate editable nodes via
 * `applySvgAstCommand` / `editAssetSvg`, and opaque subtrees stay lossless.
 */
import {
  applySvgAstCommand,
  editAssetSvg,
  parsePathCommands,
  parseSvgAst,
  serializePathCommands,
  serializeSvgAst,
  type SvgAst,
  type SvgAstAttrs,
  type SvgAstCommand,
  type SvgAstNode,
  type SvgEditableNode,
  type SvgEditableTag,
  type SvgOpaqueNode,
  type SvgPathCommand,
} from './svgAst.js';

export type SvgAstListEntry = {
  id: string;
  kind: 'editable' | 'opaque';
  depth: number;
  /** Human label for the node tree (tag, id attr, or opaque prefix). */
  label: string;
  tag?: SvgEditableTag;
  editable: boolean;
};

/** Geometry and style attrs the structured panel exposes per editable tag. */
const STRUCTURED_ATTRS: Record<SvgEditableTag, readonly string[]> = {
  svg: ['viewBox', 'width', 'height'],
  g: ['transform', 'opacity', 'fill', 'stroke', 'stroke-width'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'opacity'],
  circle: ['cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width', 'opacity'],
  ellipse: ['cx', 'cy', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'opacity'],
  line: ['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width', 'opacity'],
  polyline: ['points', 'fill', 'stroke', 'stroke-width', 'opacity'],
  polygon: ['points', 'fill', 'stroke', 'stroke-width', 'opacity'],
  // `d` is edited through path commands, not the free attr list.
  path: ['fill', 'stroke', 'stroke-width', 'opacity'],
  text: ['x', 'y', 'fill', 'font-size', 'opacity'],
  tspan: ['x', 'y', 'dx', 'dy', 'fill', 'font-size'],
};

export function structuredAttrsFor(tag: SvgEditableTag): readonly string[] {
  return STRUCTURED_ATTRS[tag];
}

function opaqueLabel(node: SvgOpaqueNode): string {
  const match = node.markup.match(/^<\s*([A-Za-z][\w:-]*)/);
  const tag = match?.[1]?.toLowerCase() ?? 'node';
  return `opaque · ${tag}`;
}

function editableLabel(node: SvgEditableNode): string {
  const named = node.attrs.id?.trim();
  return named ? `${node.tag}#${named}` : node.tag;
}

/** Flatten the AST into inspector tree rows (depth-first). */
export function listSvgAstEntries(ast: SvgAst): SvgAstListEntry[] {
  const entries: SvgAstListEntry[] = [];
  const walk = (node: SvgAstNode, depth: number) => {
    if (node.kind === 'opaque') {
      entries.push({
        id: node.id,
        kind: 'opaque',
        depth,
        label: opaqueLabel(node),
        editable: false,
      });
      return;
    }
    entries.push({
      id: node.id,
      kind: 'editable',
      depth,
      label: editableLabel(node),
      tag: node.tag,
      editable: true,
    });
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(ast.root, 0);
  return entries;
}

/** Find the first node matching `predicate` (depth-first). */
export function findSvgAstNode(
  ast: SvgAst,
  predicate: (node: SvgAstNode) => boolean,
): SvgAstNode | null {
  const walk = (node: SvgAstNode): SvgAstNode | null => {
    if (predicate(node)) return node;
    if (node.kind === 'editable') {
      for (const child of node.children) {
        const hit = walk(child);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(ast.root);
}

export function findSvgAstNodeById(ast: SvgAst, nodeId: string): SvgAstNode | null {
  return findSvgAstNode(ast, (node) => node.id === nodeId);
}

/** Opaque markup strings in document order — used to assert lossless edits. */
export function collectOpaqueMarkups(ast: SvgAst): string[] {
  const out: string[] = [];
  const walk = (node: SvgAstNode) => {
    if (node.kind === 'opaque') {
      out.push(node.markup);
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(ast.root);
  return out;
}

export type StructuredSvgEditResult = {
  svg: string;
  /** Opaque markups after the edit (must match pre-edit for structured controls). */
  opaqueMarkups: string[];
};

/**
 * Apply a structured control command and return the v1 asset.svg string.
 * Opaque subtrees are never rewritten.
 */
export function applyStructuredSvgEdit(
  svg: string,
  command: SvgAstCommand,
): StructuredSvgEditResult {
  const nextAst = applySvgAstCommand(parseSvgAst(svg), command);
  return {
    svg: serializeSvgAst(nextAst),
    opaqueMarkups: collectOpaqueMarkups(nextAst),
  };
}

/** Patch one attr on an editable node; no-op when the id is missing or opaque. */
export function patchStructuredAttrs(
  svg: string,
  nodeId: string,
  patch: SvgAstAttrs,
): StructuredSvgEditResult {
  const ast = parseSvgAst(svg);
  const node = findSvgAstNodeById(ast, nodeId);
  if (!node || node.kind !== 'editable') {
    return { svg: serializeSvgAst(ast), opaqueMarkups: collectOpaqueMarkups(ast) };
  }
  return applyStructuredSvgEdit(svg, {
    type: 'setAttrs',
    nodeId,
    attrs: { ...node.attrs, ...patch },
  });
}

/** Replace path `d` via structured commands when the grammar parses. */
export function patchStructuredPathD(
  svg: string,
  nodeId: string,
  d: string,
): StructuredSvgEditResult {
  const ast = parseSvgAst(svg);
  const node = findSvgAstNodeById(ast, nodeId);
  if (!node || node.kind !== 'editable' || node.tag !== 'path') {
    return { svg: serializeSvgAst(ast), opaqueMarkups: collectOpaqueMarkups(ast) };
  }
  try {
    const commands = parsePathCommands(d);
    return applyStructuredSvgEdit(svg, { type: 'setPathCommands', nodeId, commands });
  } catch {
    return applyStructuredSvgEdit(svg, {
      type: 'setAttrs',
      nodeId,
      attrs: { ...node.attrs, d },
    });
  }
}

export function pathCommandsToD(commands: readonly SvgPathCommand[]): string {
  return serializePathCommands(commands);
}

// Re-export AST entry points so the UI control surface and tests can import one module.
export {
  editAssetSvg,
  parseSvgAst,
  serializeSvgAst,
  type SvgAst,
  type SvgAstAttrs,
  type SvgAstCommand,
  type SvgAstNode,
  type SvgEditableNode,
  type SvgEditableTag,
  type SvgOpaqueNode,
  type SvgPathCommand,
};

/**
 * Structured SVG AST for Vector Studio.
 *
 * Consumes the sanitized SVG boundary (`sanitizeSvg`). Editable primitives are
 * exposed for Task 11 structured controls; everything else is an opaque subtree
 * whose markup survives parse → edit → serialize losslessly. Persistence stays
 * the v1 `asset.svg` string — AST is derived, never a schema bump.
 */
import { sanitizeSvg } from './svgSafety.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Tags structured editors may mutate. All other elements become opaque. */
export const EDITABLE_TAGS = new Set([
  'svg',
  'g',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'text',
  'tspan',
]);

export type SvgPathCommand =
  | { op: 'M' | 'L' | 'T'; x: number; y: number }
  | { op: 'H'; x: number }
  | { op: 'V'; y: number }
  | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'S' | 'Q'; x1: number; y1: number; x: number; y: number }
  | {
      op: 'A';
      rx: number;
      ry: number;
      rotation: number;
      largeArc: 0 | 1;
      sweep: 0 | 1;
      x: number;
      y: number;
    }
  | { op: 'Z' };

export type SvgAstAttrs = Record<string, string>;

export type SvgEditableTag =
  | 'svg'
  | 'g'
  | 'rect'
  | 'circle'
  | 'ellipse'
  | 'line'
  | 'polyline'
  | 'polygon'
  | 'path'
  | 'text'
  | 'tspan';

export type SvgEditableNode = {
  kind: 'editable';
  id: string;
  tag: SvgEditableTag;
  attrs: SvgAstAttrs;
  children: SvgAstNode[];
  /** Parsed from `d` when tag is path and the path grammar is accepted. */
  commands?: SvgPathCommand[];
  /** Character data for text/tspan. */
  text?: string;
};

export type SvgOpaqueNode = {
  kind: 'opaque';
  id: string;
  /** Exact sanitized markup of this subtree — never rewritten by structured edits. */
  markup: string;
};

export type SvgAstNode = SvgEditableNode | SvgOpaqueNode;

export type SvgAst = {
  root: SvgEditableNode;
};

export type SvgAstCommand =
  | { type: 'setAttrs'; nodeId: string; attrs: SvgAstAttrs }
  | { type: 'setPathCommands'; nodeId: string; commands: SvgPathCommand[] };

const PATH_ARG_COUNTS: Record<string, number> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

function isFiniteNumber(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Parse an SVG path `d` string into absolute-letter structured commands. */
export function parsePathCommands(d: string): SvgPathCommand[] {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g);
  if (!tokens) throw Error('Invalid path data');
  const commands: SvgPathCommand[] = [];
  let index = 0;
  let current = '';
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (/^[MmLlHhVvCcSsQqTtAaZz]$/.test(token)) {
      current = token.toUpperCase();
      index += 1;
      if (current === 'Z') {
        commands.push({ op: 'Z' });
        continue;
      }
    } else if (!current) {
      throw Error('Invalid path data');
    }
    const count = PATH_ARG_COUNTS[current];
    if (count === undefined) throw Error(`Unsupported path command ${current}`);
    if (current === 'Z') {
      commands.push({ op: 'Z' });
      continue;
    }
    if (index + count > tokens.length) throw Error('Invalid path data');
    const args = tokens.slice(index, index + count).map(Number);
    index += count;
    if (!args.every(isFiniteNumber)) throw Error('Invalid path data');
    switch (current) {
      case 'M':
      case 'L':
      case 'T':
        commands.push({ op: current, x: args[0]!, y: args[1]! });
        // Implicit line-to after moveto pairs.
        if (current === 'M') current = 'L';
        break;
      case 'H':
        commands.push({ op: 'H', x: args[0]! });
        break;
      case 'V':
        commands.push({ op: 'V', y: args[0]! });
        break;
      case 'C':
        commands.push({
          op: 'C',
          x1: args[0]!,
          y1: args[1]!,
          x2: args[2]!,
          y2: args[3]!,
          x: args[4]!,
          y: args[5]!,
        });
        break;
      case 'S':
      case 'Q':
        commands.push({
          op: current,
          x1: args[0]!,
          y1: args[1]!,
          x: args[2]!,
          y: args[3]!,
        });
        break;
      case 'A':
        commands.push({
          op: 'A',
          rx: args[0]!,
          ry: args[1]!,
          rotation: args[2]!,
          largeArc: args[3]! ? 1 : 0,
          sweep: args[4]! ? 1 : 0,
          x: args[5]!,
          y: args[6]!,
        });
        break;
      default:
        throw Error(`Unsupported path command ${current}`);
    }
  }
  return commands;
}

/** Serialize structured path commands back to an SVG `d` string. */
export function serializePathCommands(commands: readonly SvgPathCommand[]): string {
  return commands
    .map((command) => {
      switch (command.op) {
        case 'M':
        case 'L':
        case 'T':
          return `${command.op}${command.x} ${command.y}`;
        case 'H':
          return `H${command.x}`;
        case 'V':
          return `V${command.y}`;
        case 'C':
          return `C${command.x1} ${command.y1} ${command.x2} ${command.y2} ${command.x} ${command.y}`;
        case 'S':
        case 'Q':
          return `${command.op}${command.x1} ${command.y1} ${command.x} ${command.y}`;
        case 'A':
          return `A${command.rx} ${command.ry} ${command.rotation} ${command.largeArc} ${command.sweep} ${command.x} ${command.y}`;
        case 'Z':
          return 'Z';
        default: {
          const _exhaustive: never = command;
          return _exhaustive;
        }
      }
    })
    .join('');
}

function readAttrs(element: Element): SvgAstAttrs {
  const attrs: SvgAstAttrs = {};
  for (const attribute of Array.from(element.attributes)) {
    attrs[attribute.name] = attribute.value;
  }
  return attrs;
}

function createIdFactory() {
  let next = 0;
  return () => `svg-node-${next++}`;
}

function elementMarkup(element: Element): string {
  return new XMLSerializer().serializeToString(element);
}

function parseElement(element: Element, nextId: () => string): SvgAstNode {
  const tag = element.localName.toLowerCase();
  if (!EDITABLE_TAGS.has(tag)) {
    return { kind: 'opaque', id: nextId(), markup: elementMarkup(element) };
  }

  const attrs = readAttrs(element);
  const children: SvgAstNode[] = [];
  let text: string | undefined;

  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 1 /* ELEMENT_NODE */) {
      children.push(parseElement(child as Element, nextId));
    } else if (child.nodeType === 3 /* TEXT_NODE */) {
      const value = child.textContent ?? '';
      if (value.trim()) text = (text ?? '') + value;
    }
  }

  const node: SvgEditableNode = {
    kind: 'editable',
    id: nextId(),
    tag: tag as SvgEditableTag,
    attrs,
    children,
  };
  if (text !== undefined) node.text = text;

  if (tag === 'path' && typeof attrs.d === 'string' && attrs.d.trim()) {
    try {
      node.commands = parsePathCommands(attrs.d);
    } catch {
      // Keep attrs.d as the source of truth when path grammar is rejected.
    }
  }

  return node;
}

/**
 * Parse sanitized SVG into an editable/opaque AST.
 * Untrusted input is passed through `sanitizeSvg` first.
 */
export function parseSvgAst(input: string): SvgAst {
  const safe = sanitizeSvg(input);
  const doc = new DOMParser().parseFromString(safe, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw Error('Invalid SVG XML');
  const root = doc.documentElement;
  if (root.localName.toLowerCase() !== 'svg') throw Error('Expected an SVG root');
  const parsed = parseElement(root, createIdFactory());
  if (parsed.kind !== 'editable' || parsed.tag !== 'svg') {
    throw Error('Expected an editable SVG root');
  }
  if (!parsed.attrs.xmlns) parsed.attrs.xmlns = SVG_NS;
  return { root: parsed };
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * String assembly so opaque markup is spliced verbatim (DOM re-serialize would
 * normalize and break the lossless opaque contract).
 */
function serializeNodeToString(node: SvgAstNode): string {
  if (node.kind === 'opaque') return node.markup;

  const attrs = { ...node.attrs };
  if (node.tag === 'path' && node.commands) {
    attrs.d = serializePathCommands(node.commands);
  }
  if (node.tag === 'svg' && !attrs.xmlns) attrs.xmlns = SVG_NS;

  const attrText = Object.entries(attrs)
    .map(([name, value]) => ` ${name}="${escapeAttr(value)}"`)
    .join('');
  const inner =
    (node.text !== undefined ? escapeText(node.text) : '') +
    node.children.map(serializeNodeToString).join('');
  if (!inner && node.tag !== 'svg' && node.tag !== 'g' && node.tag !== 'text' && node.tag !== 'tspan') {
    return `<${node.tag}${attrText}/>`;
  }
  return `<${node.tag}${attrText}>${inner}</${node.tag}>`;
}

/** Serialize an AST back to an SVG string (v1 asset.svg persistence shape). */
export function serializeSvgAst(ast: SvgAst): string {
  return serializeNodeToString(ast.root);
}

function mapEditable(
  node: SvgAstNode,
  nodeId: string,
  map: (editable: SvgEditableNode) => SvgEditableNode,
): SvgAstNode {
  if (node.kind === 'opaque') return node;
  const children = node.children.map((child) => mapEditable(child, nodeId, map));
  const current: SvgEditableNode =
    children === node.children ? node : { ...node, children };
  return current.id === nodeId ? map(current) : current;
}

/**
 * Apply a structured AST command. Opaque nodes are never rewritten.
 * Existing v1 editor actions (`commit`/`replace`/…) stay unchanged — callers
 * serialize the result and commit the SVG string as today.
 */
export function applySvgAstCommand(ast: SvgAst, command: SvgAstCommand): SvgAst {
  switch (command.type) {
    case 'setAttrs': {
      const root = mapEditable(ast.root, command.nodeId, (node) => ({
        ...node,
        attrs: { ...command.attrs },
        commands:
          node.tag === 'path' && typeof command.attrs.d === 'string'
            ? (() => {
                try {
                  return parsePathCommands(command.attrs.d);
                } catch {
                  return undefined;
                }
              })()
            : node.commands,
      }));
      if (root.kind !== 'editable') throw Error('Expected editable SVG root');
      return { root };
    }
    case 'setPathCommands': {
      const root = mapEditable(ast.root, command.nodeId, (node) => {
        if (node.tag !== 'path') throw Error('setPathCommands requires a path node');
        return {
          ...node,
          commands: command.commands,
          attrs: { ...node.attrs, d: serializePathCommands(command.commands) },
        };
      });
      if (root.kind !== 'editable') throw Error('Expected editable SVG root');
      return { root };
    }
    default: {
      const _exhaustive: never = command;
      return _exhaustive;
    }
  }
}

/**
 * Convenience: sanitize → parse → mutate → serialize for the existing asset.svg field.
 * Backward compatible with v1 project persistence and MCP project update payloads.
 */
export function editAssetSvg(
  svg: string,
  command: SvgAstCommand,
): string {
  return serializeSvgAst(applySvgAstCommand(parseSvgAst(svg), command));
}

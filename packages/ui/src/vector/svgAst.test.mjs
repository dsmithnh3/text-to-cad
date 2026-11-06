import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const temporary = await mkdtemp(join(tmpdir(), 'text-to-cad-svg-ast-'));
const output = join(temporary, 'svg-ast.mjs');
await build({
  entryPoints: [fileURLToPath(new URL('./svgAst.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: output,
});
const dom = new JSDOM();
Object.defineProperties(globalThis, {
  DOMParser: { configurable: true, value: dom.window.DOMParser },
  XMLSerializer: { configurable: true, value: dom.window.XMLSerializer },
});
const {
  applySvgAstCommand,
  parseSvgAst,
  serializeSvgAst,
  serializePathCommands,
  parsePathCommands,
} = await import(pathToFileURL(output).href);
after(async () => {
  dom.window.close();
  await rm(temporary, { recursive: true, force: true });
});

function findByKind(node, kind, out = []) {
  if (node.kind === kind) out.push(node);
  if (node.kind === 'editable') {
    for (const child of node.children) findByKind(child, kind, out);
  }
  return out;
}

function findEditable(node, tag) {
  if (node.kind === 'editable' && node.tag === tag) return node;
  if (node.kind === 'editable') {
    for (const child of node.children) {
      const hit = findEditable(child, tag);
      if (hit) return hit;
    }
  }
  return null;
}

test('opaque subtrees survive lossless through parse/serialize', () => {
  const input = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
    <defs><linearGradient id="paint"><stop offset="0" stop-color="#111"/><stop offset="1" stop-color="#eee"/></linearGradient>
      <clipPath id="clip"><path d="M0 0h10v10z"/></clipPath></defs>
    <rect x="2" y="3" width="8" height="9" fill="url(#paint)" clip-path="url(#clip)"/>
    <use href="#clip"/>
  </svg>`;
  const ast = parseSvgAst(input);
  const opaque = findByKind(ast.root, 'opaque');
  assert.ok(opaque.length >= 2, 'defs/use (and similar) become opaque nodes');
  for (const node of opaque) {
    assert.equal(typeof node.markup, 'string');
    assert.ok(node.markup.length > 0);
    assert.match(node.markup, /^<(defs|use|clipPath|linearGradient)\b/i);
  }
  const out = serializeSvgAst(ast);
  for (const node of opaque) {
    assert.ok(out.includes(node.markup), 'opaque markup must appear verbatim after serialize');
  }
  assert.match(out, /<rect\b/);
  // Re-parse (sanitize boundary again) keeps opaque subtrees; structured content survives.
  const again = parseSvgAst(out);
  const opaqueAgain = findByKind(again.root, 'opaque');
  assert.ok(opaqueAgain.length >= 2);
  assert.ok(opaqueAgain.some((n) => /linearGradient/i.test(n.markup)));
  assert.ok(opaqueAgain.some((n) => /<use\b/i.test(n.markup)));
  assert.equal(findEditable(again.root, 'rect')?.attrs.width, '8');
});

test('editable nodes round-trip structure and structured path commands', () => {
  const input = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80">
    <g id="block">
      <rect x="10" y="20" width="30" height="40" fill="#4b6173" stroke="#111"/>
      <circle cx="70" cy="30" r="12" fill="#8ca8b8"/>
      <path d="M5 5 L25 5 L15 20 Z" fill="none" stroke="#324e64"/>
    </g>
  </svg>`;
  const ast = parseSvgAst(input);
  assert.equal(ast.root.kind, 'editable');
  assert.equal(ast.root.tag, 'svg');
  const group = findEditable(ast.root, 'g');
  const rect = findEditable(ast.root, 'rect');
  const circle = findEditable(ast.root, 'circle');
  const path = findEditable(ast.root, 'path');
  assert.ok(group && rect && circle && path);
  assert.equal(rect.attrs.x, '10');
  assert.equal(rect.attrs.width, '30');
  assert.equal(circle.attrs.r, '12');
  assert.ok(Array.isArray(path.commands));
  assert.equal(path.commands[0].op, 'M');
  assert.equal(path.commands[0].x, 5);
  assert.equal(path.commands.at(-1).op, 'Z');

  const out = serializeSvgAst(ast);
  const round = parseSvgAst(out);
  const rect2 = findEditable(round.root, 'rect');
  const path2 = findEditable(round.root, 'path');
  assert.equal(rect2.attrs.x, '10');
  assert.equal(rect2.attrs.fill, '#4b6173');
  assert.deepEqual(path2.commands, path.commands);
  assert.equal(serializePathCommands(path2.commands), serializePathCommands(parsePathCommands('M5 5L25 5L15 20Z')));
});

test('AST commands mutate editable nodes without rewriting opaque markup', () => {
  const input = `<svg xmlns="http://www.w3.org/2000/svg">
    <defs><path id="shape" d="M0 0h4v4z"/></defs>
    <rect id="target" x="1" y="2" width="3" height="4" fill="#abc"/>
    <use href="#shape"/>
  </svg>`;
  const ast = parseSvgAst(input);
  const opaqueBefore = findByKind(ast.root, 'opaque').map((n) => n.markup);
  assert.ok(opaqueBefore.length >= 2);
  const rect = findEditable(ast.root, 'rect');
  assert.ok(rect);

  const next = applySvgAstCommand(ast, {
    type: 'setAttrs',
    nodeId: rect.id,
    attrs: { ...rect.attrs, x: '15', width: '12' },
  });
  const opaqueAfter = findByKind(next.root, 'opaque').map((n) => n.markup);
  assert.deepEqual(opaqueAfter, opaqueBefore, 'opaque markup must be unchanged by structured edits');

  const edited = findEditable(next.root, 'rect');
  assert.equal(edited.attrs.x, '15');
  assert.equal(edited.attrs.width, '12');
  assert.equal(edited.attrs.y, '2');

  const path = findEditable(next.root, 'path');
  // path lives inside opaque defs — not reachable as editable
  assert.equal(path, null);

  const withPath = parseSvgAst(`<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 0 Z"/></svg>`);
  const editablePath = findEditable(withPath.root, 'path');
  const moved = applySvgAstCommand(withPath, {
    type: 'setPathCommands',
    nodeId: editablePath.id,
    commands: [
      { op: 'M', x: 2, y: 3 },
      { op: 'L', x: 12, y: 3 },
      { op: 'Z' },
    ],
  });
  const movedPath = findEditable(moved.root, 'path');
  assert.deepEqual(movedPath.commands[0], { op: 'M', x: 2, y: 3 });
  assert.match(serializeSvgAst(moved), /d="M2 3L12 3Z"/);
});

test('v1 project svg string remains the persistence surface (AST is derived)', () => {
  // AST must not require a project-schema bump: serialize back to a normal SVG string
  // that existing sanitizeSvg + parseVectorProject paths already accept.
  const svg = serializeSvgAst(parseSvgAst(
    '<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="1" height="1"/></svg>',
  ));
  assert.match(svg, /^<svg\b/);
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.doesNotMatch(svg, /\bkind=|"editable"|"opaque"/);
});

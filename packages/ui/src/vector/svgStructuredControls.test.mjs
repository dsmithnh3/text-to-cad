import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const temporary = await mkdtemp(join(tmpdir(), 'text-to-cad-svg-controls-'));
const output = join(temporary, 'svg-structured-controls.mjs');
await build({
  entryPoints: [fileURLToPath(new URL('./svgStructuredControls.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: output,
  external: ['react', 'react/jsx-runtime', 'lucide-react'],
});
const dom = new JSDOM();
Object.defineProperties(globalThis, {
  DOMParser: { configurable: true, value: dom.window.DOMParser },
  XMLSerializer: { configurable: true, value: dom.window.XMLSerializer },
});
const {
  applyStructuredSvgEdit,
  collectOpaqueMarkups,
  findSvgAstNode,
  listSvgAstEntries,
  parseSvgAst,
  serializeSvgAst,
  structuredAttrsFor,
} = await import(pathToFileURL(output).href);
after(async () => {
  dom.window.close();
  await rm(temporary, { recursive: true, force: true });
});

const SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
  <defs><linearGradient id="paint"><stop offset="0" stop-color="#111"/></linearGradient></defs>
  <rect id="plate" x="2" y="3" width="8" height="9" fill="#abc" stroke="#111"/>
  <circle cx="20" cy="20" r="5" fill="#8ca8b8"/>
  <path d="M1 1 L9 1 L5 8 Z" fill="none" stroke="#324e64"/>
  <use href="#paint"/>
</svg>`;

test('listSvgAstEntries exposes editable nodes and marks opaque nodes non-editable', () => {
  const ast = parseSvgAst(SAMPLE);
  const entries = listSvgAstEntries(ast);
  assert.ok(entries.some((e) => e.kind === 'editable' && e.tag === 'rect' && e.editable));
  assert.ok(entries.some((e) => e.kind === 'editable' && e.tag === 'circle' && e.editable));
  assert.ok(entries.some((e) => e.kind === 'editable' && e.tag === 'path' && e.editable));
  const opaque = entries.filter((e) => e.kind === 'opaque');
  assert.ok(opaque.length >= 2);
  for (const entry of opaque) {
    assert.equal(entry.editable, false);
    assert.match(entry.label, /opaque/i);
  }
});

test('structured attrs for editable tags include geometry fields and exclude opaque-only work', () => {
  assert.deepEqual([...structuredAttrsFor('rect')].sort(), [
    'fill', 'height', 'opacity', 'rx', 'ry', 'stroke', 'stroke-width', 'width', 'x', 'y',
  ].sort());
  assert.ok(structuredAttrsFor('circle').includes('cx'));
  assert.ok(structuredAttrsFor('path').includes('fill'));
  assert.ok(!structuredAttrsFor('path').includes('d'), 'path d is edited via path commands, not free attrs alone');
});

test('structured attr edit updates editable AST without rewriting opaque markup', () => {
  const before = parseSvgAst(SAMPLE);
  const opaqueBefore = collectOpaqueMarkups(before);
  assert.ok(opaqueBefore.length >= 2);

  const rect = findSvgAstNode(before, (n) => n.kind === 'editable' && n.tag === 'rect');
  assert.ok(rect && rect.kind === 'editable');

  const result = applyStructuredSvgEdit(SAMPLE, {
    type: 'setAttrs',
    nodeId: rect.id,
    attrs: { ...rect.attrs, x: '15', width: '12', fill: '#4b6173' },
  });

  assert.deepEqual(result.opaqueMarkups, opaqueBefore, 'opaque markup must be unchanged');
  for (const markup of opaqueBefore) {
    assert.ok(result.svg.includes(markup), 'serialized SVG must splice opaque markup verbatim');
  }

  const after = parseSvgAst(result.svg);
  const edited = findSvgAstNode(after, (n) => n.kind === 'editable' && n.tag === 'rect');
  assert.ok(edited && edited.kind === 'editable');
  assert.equal(edited.attrs.x, '15');
  assert.equal(edited.attrs.width, '12');
  assert.equal(edited.attrs.fill, '#4b6173');
  assert.equal(edited.attrs.y, '3');
  assert.deepEqual(collectOpaqueMarkups(after), opaqueBefore);
});

test('structured path edit updates path commands without touching opaque nodes', () => {
  const before = parseSvgAst(SAMPLE);
  const opaqueBefore = collectOpaqueMarkups(before);
  const path = findSvgAstNode(before, (n) => n.kind === 'editable' && n.tag === 'path');
  assert.ok(path && path.kind === 'editable' && path.commands);

  const result = applyStructuredSvgEdit(SAMPLE, {
    type: 'setPathCommands',
    nodeId: path.id,
    commands: [
      { op: 'M', x: 2, y: 3 },
      { op: 'L', x: 12, y: 3 },
      { op: 'L', x: 7, y: 10 },
      { op: 'Z' },
    ],
  });

  assert.deepEqual(result.opaqueMarkups, opaqueBefore);
  const after = parseSvgAst(result.svg);
  const moved = findSvgAstNode(after, (n) => n.kind === 'editable' && n.tag === 'path');
  assert.ok(moved && moved.kind === 'editable');
  assert.deepEqual(moved.commands[0], { op: 'M', x: 2, y: 3 });
  assert.match(serializeSvgAst(after), /d="M2 3L12 3L7 10Z"/);
});

test('selecting an opaque node id does not rewrite its markup via structured controls', () => {
  const before = parseSvgAst(SAMPLE);
  const opaque = findSvgAstNode(before, (n) => n.kind === 'opaque');
  assert.ok(opaque && opaque.kind === 'opaque');
  const markup = opaque.markup;

  const result = applyStructuredSvgEdit(SAMPLE, {
    type: 'setAttrs',
    nodeId: opaque.id,
    attrs: { fill: '#ff0000' },
  });

  assert.ok(result.svg.includes(markup));
  assert.ok(collectOpaqueMarkups(parseSvgAst(result.svg)).includes(markup));
  assert.doesNotMatch(markup, /fill="#ff0000"/);
});

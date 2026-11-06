import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const temporary = await mkdtemp(join(tmpdir(), 'text-to-cad-web-svg-controls-'));
const output = join(temporary, 'svg-structured-controls.mjs');
await build({
  entryPoints: [fileURLToPath(new URL('../../../../packages/ui/src/vector/svgStructuredControls.ts', import.meta.url))],
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
  applyStructuredSvgEdit,
  collectOpaqueMarkups,
  findSvgAstNode,
  listSvgAstEntries,
  parseSvgAst,
} = await import(pathToFileURL(output).href);
after(async () => {
  dom.window.close();
  await rm(temporary, { recursive: true, force: true });
});

test('web host structured controls edit editable nodes without rewriting opaque markup', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs>
    <rect x="1" y="2" width="3" height="4" fill="#abc"/>
  </svg>`;
  const ast = parseSvgAst(svg);
  const opaqueBefore = collectOpaqueMarkups(ast);
  assert.ok(opaqueBefore.length >= 1);
  assert.ok(listSvgAstEntries(ast).some((e) => e.kind === 'opaque' && !e.editable));

  const rect = findSvgAstNode(ast, (n) => n.kind === 'editable' && n.tag === 'rect');
  assert.ok(rect && rect.kind === 'editable');
  const result = applyStructuredSvgEdit(svg, {
    type: 'setAttrs',
    nodeId: rect.id,
    attrs: { ...rect.attrs, width: '20' },
  });
  assert.deepEqual(result.opaqueMarkups, opaqueBefore);
  for (const markup of opaqueBefore) assert.ok(result.svg.includes(markup));
  assert.match(result.svg, /width="20"/);
});

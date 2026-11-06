import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const temporary = await mkdtemp(join(tmpdir(), 'text-to-cad-web-svg-ast-'));
const output = join(temporary, 'svg-ast.mjs');
await build({
  entryPoints: [fileURLToPath(new URL('../../../../packages/ui/src/vector/svgAst.ts', import.meta.url))],
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
const { applySvgAstCommand, parseSvgAst, serializeSvgAst } = await import(pathToFileURL(output).href);
after(async () => {
  dom.window.close();
  await rm(temporary, { recursive: true, force: true });
});

test('web host can derive AST from sanitized SVG and keep opaque markup', () => {
  const ast = parseSvgAst(`<svg xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g"/></defs>
    <rect x="1" y="2" width="3" height="4"/>
  </svg>`);
  const opaque = [];
  const walk = (node) => {
    if (node.kind === 'opaque') opaque.push(node);
    if (node.kind === 'editable') node.children.forEach(walk);
  };
  walk(ast.root);
  assert.ok(opaque.length >= 1);
  const rect = ast.root.children.find((n) => n.kind === 'editable' && n.tag === 'rect');
  assert.ok(rect && rect.kind === 'editable');
  const next = applySvgAstCommand(ast, {
    type: 'setAttrs',
    nodeId: rect.id,
    attrs: { ...rect.attrs, x: '9' },
  });
  assert.equal(
    opaque.map((n) => n.markup).join('\0'),
    (() => {
      const kept = [];
      const visit = (node) => {
        if (node.kind === 'opaque') kept.push(node);
        if (node.kind === 'editable') node.children.forEach(visit);
      };
      visit(next.root);
      return kept.map((n) => n.markup).join('\0');
    })(),
  );
  assert.match(serializeSvgAst(next), /x="9"/);
});

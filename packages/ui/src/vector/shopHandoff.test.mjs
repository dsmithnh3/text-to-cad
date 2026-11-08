import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const temporary = await mkdtemp(join(tmpdir(), 'text-to-cad-shop-handoff-'));
const output = join(temporary, 'shop-handoff.mjs');
await build({
  entryPoints: [fileURLToPath(new URL('./shopHandoff.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: output,
});
const { canShopHandoff, formatShopHandoffPrompt } = await import(pathToFileURL(output).href);
after(async () => {
  await rm(temporary, { recursive: true, force: true });
});

test('canShopHandoff requires path or documentId', () => {
  assert.equal(canShopHandoff({}), false);
  assert.equal(canShopHandoff({ path: '/tmp/box.step' }), true);
  assert.equal(canShopHandoff({ documentId: 'doc-1' }), true);
});

test('formatShopHandoffPrompt names skill and CAD source, not Vector SVG as manufacturing', () => {
  const text = formatShopHandoffPrompt({
    kind: 'engineering-drawing',
    path: '/tmp/box.step',
    documentId: 'doc-1',
    projectionRevisionId: 'rev-1',
    name: 'box',
  });
  assert.match(text, /\$engineering-drawing/);
  assert.match(text, /\/tmp\/box\.step/);
  assert.match(text, /doc-1/);
  assert.match(text, /rev-1/);
  assert.match(text, /not on Vector Studio SVG/i);
  assert.match(text, /Do not treat illustrative GLB mesh SVG or Vector composition as manufacturing geometry/);
});

test('DXF handoff names dxf skill', () => {
  const text = formatShopHandoffPrompt({ kind: 'dxf', path: '/tmp/box.step' });
  assert.match(text, /\$dxf/);
  assert.match(text, /cut DXF|flat pattern|DXF/i);
});

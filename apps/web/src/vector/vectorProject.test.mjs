import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const temporary = await mkdtemp(join(tmpdir(), 'text-to-cad-vector-project-'));
const output = join(temporary, 'vector-project.mjs');
await build({
  entryPoints: [fileURLToPath(new URL('../../../../packages/ui/src/vector/vectorProject.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: output,
});
const {
  MAX_AGGREGATE_SVG_BYTES,
  MAX_ASSET_COUNT,
  MAX_DIMENSION,
  MAX_ITEM_COUNT,
  MAX_PROJECT_BYTES,
  parseVectorProject,
  VectorProjectError,
} = await import(pathToFileURL(output).href);
after(async () => {
  await rm(temporary, { recursive: true, force: true });
});

const tinySvg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';

function project(overrides = {}) {
  return {
    schema: 'cad-vector-studio/v1',
    name: 'fixture',
    width: 1200,
    height: 760,
    assets: [{ id: 'a1', name: 'A', category: 'Test', svg: tinySvg, provenance: 'user-import' }],
    items: [{
      id: 'i1', assetId: 'a1', name: 'A', x: 0, y: 0, w: 10, h: 10,
      rotate: 0, opacity: 1, hidden: false, locked: false,
    }],
    ...overrides,
  };
}

function encode(value) {
  return JSON.stringify(value);
}

test('accepts a valid in-budget project at exact aggregate limits', () => {
  const assets = Array.from({ length: MAX_ASSET_COUNT }, (_, index) => ({
    id: `a${index}`,
    name: `A${index}`,
    category: 'Test',
    svg: tinySvg,
    provenance: 'user-import',
  }));
  const items = Array.from({ length: MAX_ITEM_COUNT }, (_, index) => ({
    id: `i${index}`,
    assetId: assets[index % assets.length].id,
    name: `I${index}`,
    x: 0,
    y: 0,
    w: MAX_DIMENSION,
    h: MAX_DIMENSION,
    rotate: 0,
    opacity: 1,
    hidden: false,
    locked: false,
  }));
  // Keep aggregate SVG under the cap while saturating counts/dimensions.
  const parsed = parseVectorProject(encode(project({
    width: MAX_DIMENSION,
    height: MAX_DIMENSION,
    assets,
    items,
  })));
  assert.equal(parsed.assets.length, MAX_ASSET_COUNT);
  assert.equal(parsed.items.length, MAX_ITEM_COUNT);
  assert.equal(parsed.width, MAX_DIMENSION);
});

test('rejects project text over MAX_PROJECT_BYTES', () => {
  const padding = 'x'.repeat(MAX_PROJECT_BYTES);
  const text = encode(project({ name: padding }));
  assert.ok(text.length > MAX_PROJECT_BYTES);
  assert.throws(() => parseVectorProject(text), (error) => {
    assert.ok(error instanceof VectorProjectError);
    assert.match(error.message, /project bytes|too large|MAX_PROJECT_BYTES/i);
    return true;
  });
});

test('rejects one asset past MAX_ASSET_COUNT', () => {
  const assets = Array.from({ length: MAX_ASSET_COUNT + 1 }, (_, index) => ({
    id: `a${index}`, name: `A${index}`, category: 'Test', svg: tinySvg, provenance: 'user-import',
  }));
  assert.throws(() => parseVectorProject(encode(project({ assets, items: [] }))), (error) => {
    assert.ok(error instanceof VectorProjectError);
    assert.match(error.message, /asset/i);
    return true;
  });
});

test('rejects one item past MAX_ITEM_COUNT', () => {
  const items = Array.from({ length: MAX_ITEM_COUNT + 1 }, (_, index) => ({
    id: `i${index}`, assetId: 'a1', name: `I${index}`, x: 0, y: 0, w: 1, h: 1,
    rotate: 0, opacity: 1, hidden: false, locked: false,
  }));
  assert.throws(() => parseVectorProject(encode(project({ items }))), (error) => {
    assert.ok(error instanceof VectorProjectError);
    assert.match(error.message, /item/i);
    return true;
  });
});

test('rejects aggregate SVG bytes one past the limit', () => {
  const chunk = 'a'.repeat(1_000_000);
  const assets = [];
  let total = 0;
  while (total + chunk.length <= MAX_AGGREGATE_SVG_BYTES) {
    assets.push({
      id: `a${assets.length}`,
      name: `A${assets.length}`,
      category: 'Test',
      svg: chunk,
      provenance: 'user-import',
    });
    total += chunk.length;
  }
  const remainder = MAX_AGGREGATE_SVG_BYTES - total + 1;
  assets.push({
    id: `a${assets.length}`,
    name: 'overflow',
    category: 'Test',
    svg: 'b'.repeat(remainder),
    provenance: 'user-import',
  });
  assert.throws(() => parseVectorProject(encode(project({ assets, items: [] }))), (error) => {
    assert.ok(error instanceof VectorProjectError);
    assert.match(error.message, /aggregate|svg bytes/i);
    return true;
  });
});

test('rejects non-finite transforms and non-positive sizes', () => {
  for (const patch of [
    { x: Number.NaN },
    { y: Number.POSITIVE_INFINITY },
    { rotate: Number.NEGATIVE_INFINITY },
    { opacity: Number.NaN },
    { w: 0 },
    { h: -1 },
    { w: MAX_DIMENSION + 1 },
  ]) {
    const items = [{
      id: 'i1', assetId: 'a1', name: 'A', x: 0, y: 0, w: 10, h: 10,
      rotate: 0, opacity: 1, hidden: false, locked: false, ...patch,
    }];
    assert.throws(() => parseVectorProject(encode(project({ items }))), VectorProjectError);
  }
  assert.throws(
    () => parseVectorProject(encode(project({ width: MAX_DIMENSION + 1 }))),
    VectorProjectError,
  );
});

test('rejects unsupported schema and malformed JSON', () => {
  assert.throws(() => parseVectorProject('{'), VectorProjectError);
  assert.throws(
    () => parseVectorProject(encode({ ...project(), schema: 'other' })),
    VectorProjectError,
  );
});

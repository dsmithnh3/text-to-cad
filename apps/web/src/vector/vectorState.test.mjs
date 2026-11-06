import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const temporary = await mkdtemp(join(tmpdir(), 'text-to-cad-vector-state-'));
const output = join(temporary, 'vector-state.mjs');
await build({
  entryPoints: [fileURLToPath(new URL('../../../../packages/ui/src/vector/vectorState.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: output,
});
const { createVectorState, reduceVectorState, MAX_HISTORY } = await import(pathToFileURL(output).href);
after(async () => {
  await rm(temporary, { recursive: true, force: true });
});

const asset = {
  id: 'asset-1',
  name: 'Block',
  category: 'Test',
  svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
  provenance: 'user-import',
};
const item = {
  id: 'item-1',
  assetId: 'asset-1',
  name: 'Block',
  x: 10,
  y: 20,
  w: 100,
  h: 80,
  rotate: 0,
  opacity: 1,
  hidden: false,
  locked: false,
};

function emptyProject() {
  return {
    schema: 'cad-vector-studio/v1',
    name: 'Untitled',
    width: 1200,
    height: 760,
    assets: [],
    items: [],
  };
}

function dispatch(state, action) {
  // Simulate React Strict Mode: pure reducers are invoked twice with the same args.
  const first = reduceVectorState(state, action);
  const second = reduceVectorState(state, action);
  assert.deepEqual(first, second);
  return first;
}

test('insert records one past entry even when Strict Mode double-invokes', () => {
  let state = createVectorState(emptyProject());
  state = dispatch(state, {
    type: 'commit',
    project: { ...emptyProject(), items: [item] },
  });
  assert.equal(state.past.length, 1);
  assert.equal(state.project.items.length, 1);
  assert.equal(state.future.length, 0);
});

test('drag preview does not push history until drag commit', () => {
  const baseline = { ...emptyProject(), items: [item] };
  let state = createVectorState(baseline);
  state = dispatch(state, {
    type: 'preview',
    project: { ...state.project, items: [{ ...item, x: 50, y: 60 }] },
  });
  assert.equal(state.past.length, 0);
  assert.equal(state.project.items[0].x, 50);
  state = dispatch(state, {
    type: 'commit',
    project: { ...state.project, items: [{ ...item, x: 50, y: 60 }] },
    baseline,
  });
  assert.equal(state.past.length, 1);
  assert.deepEqual(state.past[0].items[0], item);
});

test('source edit commits one transaction', () => {
  const withAsset = { ...emptyProject(), assets: [asset], items: [item] };
  let state = createVectorState(withAsset);
  const edited = {
    ...withAsset,
    assets: [{ ...asset, svg: '<svg xmlns="http://www.w3.org/2000/svg"><circle/></svg>' }],
  };
  state = dispatch(state, { type: 'commit', project: edited });
  assert.equal(state.past.length, 1);
  assert.match(state.project.assets[0].svg, /circle/);
});

test('GLB asset+instance insertion is a single transaction', () => {
  let state = createVectorState(emptyProject());
  const next = {
    ...emptyProject(),
    assets: [asset],
    items: [item],
  };
  state = dispatch(state, { type: 'commit', project: next });
  assert.equal(state.past.length, 1);
  assert.equal(state.past[0].assets.length, 0);
  assert.equal(state.project.assets.length, 1);
  assert.equal(state.project.items.length, 1);
});

test('undo and redo walk one transaction at a time', () => {
  let state = createVectorState(emptyProject());
  state = dispatch(state, {
    type: 'commit',
    project: { ...emptyProject(), items: [item] },
  });
  state = dispatch(state, {
    type: 'commit',
    project: { ...emptyProject(), items: [{ ...item, x: 99 }] },
  });
  assert.equal(state.past.length, 2);
  state = dispatch(state, { type: 'undo' });
  assert.equal(state.project.items[0].x, 10);
  assert.equal(state.future.length, 1);
  state = dispatch(state, { type: 'redo' });
  assert.equal(state.project.items[0].x, 99);
  assert.equal(state.future.length, 0);
});

test('replace loads a project without inventing history', () => {
  let state = createVectorState(emptyProject());
  state = dispatch(state, {
    type: 'commit',
    project: { ...emptyProject(), items: [item] },
  });
  state = dispatch(state, {
    type: 'replace',
    project: { ...emptyProject(), name: 'Restored' },
  });
  assert.equal(state.project.name, 'Restored');
  assert.equal(state.past.length, 0);
  assert.equal(state.future.length, 0);
});

test('history is capped at MAX_HISTORY', () => {
  let state = createVectorState(emptyProject());
  for (let index = 0; index < MAX_HISTORY + 5; index += 1) {
    state = reduceVectorState(state, {
      type: 'commit',
      project: { ...emptyProject(), name: `n${index}` },
    });
  }
  assert.equal(state.past.length, MAX_HISTORY);
});

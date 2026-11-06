import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const temporary = await mkdtemp(join(tmpdir(), 'text-to-cad-vector-draft-'));
const output = join(temporary, 'vector-draft.mjs');
await build({
  entryPoints: [fileURLToPath(new URL('./vectorDraft.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: output,
});
const {
  VECTOR_DRAFT_KEY,
  VECTOR_DRAFT_VERSION,
  readVectorDraft,
  writeVectorDraft,
  persistCommittedDraft,
  shouldPersistVectorDraft,
} = await import(pathToFileURL(output).href);
after(async () => {
  await rm(temporary, { recursive: true, force: true });
});

function memoryStorage(seed = new Map()) {
  const entries = seed instanceof Map ? new Map(seed) : new Map(Object.entries(seed));
  return {
    entries,
    getItem(key) {
      return entries.has(key) ? entries.get(key) : null;
    },
    setItem(key, value) {
      entries.set(key, String(value));
    },
    removeItem(key) {
      entries.delete(key);
    },
  };
}

function sampleProject(overrides = {}) {
  return {
    schema: 'cad-vector-studio/v1',
    name: 'Draft assembly',
    width: 1200,
    height: 760,
    assets: [
      {
        id: 'a1',
        name: 'Block',
        category: 'Test',
        svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
        provenance: 'user-import',
      },
    ],
    items: [
      {
        id: 'i1',
        assetId: 'a1',
        name: 'Block',
        x: 10,
        y: 20,
        w: 100,
        h: 80,
        rotate: 0,
        opacity: 1,
        hidden: false,
        locked: false,
      },
    ],
    ...overrides,
  };
}

test('write then read restores the committed project through the versioned key', () => {
  const storage = memoryStorage();
  const project = sampleProject();
  const written = writeVectorDraft(storage, project);
  assert.equal(written.ok, true);
  assert.equal([...storage.entries.keys()].length, 1);
  assert.equal([...storage.entries.keys()][0], VECTOR_DRAFT_KEY);
  const envelope = JSON.parse(storage.getItem(VECTOR_DRAFT_KEY));
  assert.equal(envelope.version, VECTOR_DRAFT_VERSION);
  assert.deepEqual(readVectorDraft(storage), project);
});

test('read restores a legacy bare project payload under the same key', () => {
  const project = sampleProject({ name: 'Legacy draft' });
  const storage = memoryStorage(new Map([[VECTOR_DRAFT_KEY, JSON.stringify(project)]]));
  assert.deepEqual(readVectorDraft(storage), project);
});

test('storage quota failures are reported without throwing', () => {
  const storage = {
    getItem() {
      return null;
    },
    setItem() {
      const error = new Error('exceeded');
      error.name = 'QuotaExceededError';
      throw error;
    },
  };
  const result = writeVectorDraft(storage, sampleProject());
  assert.equal(result.ok, false);
  assert.equal(result.error, 'quota');
  assert.match(result.message, /quota/i);
});

test('blocked writes are reported without throwing', () => {
  const storage = {
    getItem() {
      return null;
    },
    setItem() {
      throw new Error('SecurityError');
    },
  };
  const result = writeVectorDraft(storage, sampleProject());
  assert.equal(result.ok, false);
  assert.equal(result.error, 'blocked');
});

test('over-budget drafts are rejected at the adapter boundary', () => {
  const storage = memoryStorage();
  const oversized = sampleProject({
    width: 100_001,
  });
  const written = writeVectorDraft(storage, oversized);
  assert.equal(written.ok, false);
  assert.equal(written.error, 'invalid');
  assert.equal(storage.entries.size, 0);

  storage.setItem(VECTOR_DRAFT_KEY, JSON.stringify({
    version: VECTOR_DRAFT_VERSION,
    project: oversized,
  }));
  assert.equal(readVectorDraft(storage), null);
});

test('malformed drafts restore as null', () => {
  const storage = memoryStorage(new Map([[VECTOR_DRAFT_KEY, '{not-json']]));
  assert.equal(readVectorDraft(storage), null);
  assert.equal(readVectorDraft(memoryStorage()), null);
});

test('only committed reducer revisions are persisted', () => {
  assert.equal(shouldPersistVectorDraft({ type: 'preview', project: sampleProject() }), false);
  assert.equal(shouldPersistVectorDraft({ type: 'commit', project: sampleProject() }), true);
  assert.equal(shouldPersistVectorDraft({ type: 'undo' }), true);
  assert.equal(shouldPersistVectorDraft({ type: 'redo' }), true);
  assert.equal(shouldPersistVectorDraft({ type: 'replace', project: sampleProject() }), true);

  const storage = memoryStorage();
  assert.equal(persistCommittedDraft(storage, { type: 'preview', project: sampleProject({ name: 'Dragging' }) }, sampleProject({ name: 'Dragging' })), null);
  assert.equal(storage.entries.size, 0, 'preview must not write');

  const committed = sampleProject({ name: 'Committed' });
  const result = persistCommittedDraft(storage, { type: 'commit', project: committed }, committed);
  assert.equal(result.ok, true);
  assert.deepEqual(readVectorDraft(storage), committed);
});

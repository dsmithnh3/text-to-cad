import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const temporary = await mkdtemp(join(tmpdir(), 'text-to-cad-vector-project-store-'));
const output = join(temporary, 'vector-project-store.mjs');
await build({
  entryPoints: [fileURLToPath(new URL('./vectorProjectStore.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: output,
});
const {
  VECTOR_PROJECTS_ROUTE,
  VectorProjectStoreClientError,
  createVectorProject,
  getVectorProject,
  updateVectorProject,
} = await import(pathToFileURL(output).href);
after(async () => {
  await rm(temporary, { recursive: true, force: true });
});

function sampleProject(overrides = {}) {
  return {
    schema: 'cad-vector-studio/v1',
    name: 'Client assembly',
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

function memoryTransport(seed = new Map()) {
  const documents = seed instanceof Map ? new Map(seed) : new Map();
  const calls = [];
  return {
    documents,
    calls,
    async request(method, path, body) {
      calls.push({ method, path, body });
      if (method === 'POST' && path === VECTOR_PROJECTS_ROUTE) {
        const id = '11111111-1111-4111-8111-111111111111';
        const document = { id, revision: 1, project: body.project };
        documents.set(id, document);
        return { status: 201, json: document };
      }
      const match = path.match(new RegExp(`^${VECTOR_PROJECTS_ROUTE}/([^/]+)$`));
      if (!match) return { status: 404, json: { error: 'no route' } };
      const id = decodeURIComponent(match[1]);
      if (method === 'GET') {
        const document = documents.get(id);
        if (!document) return { status: 404, json: { error: `no vector project ${id}` } };
        return { status: 200, json: document };
      }
      if (method === 'PUT') {
        const document = documents.get(id);
        if (!document) return { status: 404, json: { error: `no vector project ${id}` } };
        if (body.expectedRevision !== document.revision) {
          return {
            status: 409,
            json: {
              error: `expected revision ${body.expectedRevision}, current is ${document.revision}`,
              currentRevision: document.revision,
            },
          };
        }
        const next = { id, revision: document.revision + 1, project: body.project };
        documents.set(id, next);
        return { status: 200, json: next };
      }
      return { status: 405, json: { error: 'method not allowed' } };
    },
  };
}

test('create then get then update with expected revision', async () => {
  const transport = memoryTransport();
  const created = await createVectorProject(transport, sampleProject());
  assert.equal(created.revision, 1);
  const loaded = await getVectorProject(transport, created.id);
  assert.equal(loaded.project.name, 'Client assembly');
  const updated = await updateVectorProject(transport, created.id, 1, sampleProject({ name: 'Next' }));
  assert.equal(updated.revision, 2);
  assert.equal(updated.project.name, 'Next');
});

test('stale expected revision surfaces as stale without applying a second write path', async () => {
  const transport = memoryTransport();
  const created = await createVectorProject(transport, sampleProject());
  await updateVectorProject(transport, created.id, 1, sampleProject({ name: 'First' }));
  await assert.rejects(
    () => updateVectorProject(transport, created.id, 1, sampleProject({ name: 'Stale' })),
    (error) => {
      assert.ok(error instanceof VectorProjectStoreClientError);
      assert.equal(error.code, 'stale');
      assert.equal(error.currentRevision, 2);
      return true;
    },
  );
  assert.equal(transport.documents.get(created.id).project.name, 'First');
});

test('invalid project is rejected before the transport runs', async () => {
  const transport = memoryTransport();
  await assert.rejects(
    () => createVectorProject(transport, sampleProject({ width: Number.NaN })),
    (error) => {
      assert.ok(error instanceof VectorProjectStoreClientError);
      assert.equal(error.code, 'invalid');
      return true;
    },
  );
  assert.equal(transport.calls.length, 0);

  const created = await createVectorProject(transport, sampleProject());
  const before = transport.calls.length;
  await assert.rejects(
    () => updateVectorProject(transport, created.id, 1, sampleProject({ schema: 'wrong' })),
    (error) => error instanceof VectorProjectStoreClientError && error.code === 'invalid',
  );
  assert.equal(transport.calls.length, before);
});

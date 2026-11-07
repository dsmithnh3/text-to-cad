import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const temporary = await mkdtemp(join(tmpdir(), 'text-to-cad-vector-projections-'));
const output = join(temporary, 'vector-projections.mjs');
await build({
  entryPoints: [fileURLToPath(new URL('./vectorProjections.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: output,
});
const {
  VECTOR_PROJECTIONS_ROUTE,
  VectorProjectionClientError,
  listProjectionRevisions,
  publishProjection,
  regenerateProjection,
  createBrowserVectorProjectionTransport,
} = await import(pathToFileURL(output).href);
after(async () => {
  await rm(temporary, { recursive: true, force: true });
});

const sampleEntry = {
  revisionId: '11111111-1111-4111-8111-111111111111',
  assetId: '22222222-2222-4222-8222-222222222222',
  revision: 1,
  asset: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Box · isometric',
    category: 'CAD projection',
    svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    provenance: 'source-derived',
  },
  projection: {
    kind: 'cad-projection',
    backend: 'hlr-occt',
    view: 'iso',
    viewClass: 'isometric',
    hiddenLines: true,
    source: { path: '/tmp/box.step' },
  },
};

test('publishProjection posts file+view and listProjectionRevisions reads entries', async () => {
  const calls = [];
  const transport = {
    async request(method, path, body) {
      calls.push({ method, path, body });
      if (method === 'POST' && path === VECTOR_PROJECTIONS_ROUTE) {
        return { status: 201, json: sampleEntry };
      }
      if (method === 'GET' && path === VECTOR_PROJECTIONS_ROUTE) {
        return { status: 200, json: { entries: [sampleEntry] } };
      }
      return { status: 404, json: { error: 'missing' } };
    },
  };
  const published = await publishProjection(transport, { file: '/tmp/box.step', view: 'iso' });
  assert.equal(published.revisionId, sampleEntry.revisionId);
  assert.equal(calls[0].body.view, 'iso');
  const listed = await listProjectionRevisions(transport);
  assert.equal(listed.length, 1);
});

test('regenerateProjection surfaces stale 409 with currentRevision', async () => {
  const transport = {
    async request() {
      return {
        status: 409,
        json: { error: 'expected revision 1, current is 2', currentRevision: 2 },
      };
    },
  };
  await assert.rejects(
    () => regenerateProjection(transport, sampleEntry.revisionId, 1),
    (error) => {
      assert.equal(error instanceof VectorProjectionClientError, true);
      assert.equal(error.code, 'stale');
      assert.equal(error.currentRevision, 2);
      return true;
    },
  );
});

test('browser transport sends x-cad-viewer guard header', async () => {
  const fetches = [];
  const fetchImpl = async (url, init) => {
    fetches.push({ url, init });
    return new Response(JSON.stringify({ entries: [] }), { status: 200 });
  };
  const transport = createBrowserVectorProjectionTransport(fetchImpl);
  await listProjectionRevisions(transport);
  assert.equal(fetches[0].url, VECTOR_PROJECTIONS_ROUTE);
  assert.equal(fetches[0].init.headers['x-cad-viewer'], '1');
});

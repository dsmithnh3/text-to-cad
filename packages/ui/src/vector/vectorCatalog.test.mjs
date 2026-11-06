import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const temporary = await mkdtemp(join(tmpdir(), 'text-to-cad-vector-catalog-'));
const output = join(temporary, 'vector-catalog.mjs');
await build({
  entryPoints: [fileURLToPath(new URL('./vectorCatalog.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: output,
});
const {
  VECTOR_CATALOG_ROUTE,
  VectorCatalogClientError,
  getCatalogRevision,
  listCatalogRevisions,
  publishCatalogComponent,
} = await import(pathToFileURL(output).href);
after(async () => {
  await rm(temporary, { recursive: true, force: true });
});

function sampleComponent(overrides = {}) {
  return {
    name: 'Pump block',
    category: 'Equipment',
    svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
    provenance: 'user-import',
    ...overrides,
  };
}

function memoryTransport(seed = new Map()) {
  const entries = seed instanceof Map ? new Map(seed) : new Map();
  const calls = [];
  let sequence = 0;
  return {
    entries,
    calls,
    async request(method, path, body) {
      calls.push({ method, path, body });
      if (method === 'GET' && path === VECTOR_CATALOG_ROUTE) {
        return { status: 200, json: { entries: [...entries.values()] } };
      }
      if (method === 'POST' && path === VECTOR_CATALOG_ROUTE) {
        sequence += 1;
        const revisionId = `22222222-2222-4222-8222-${String(sequence).padStart(12, '0')}`;
        const componentId = body.componentId || `11111111-1111-4111-8111-${String(sequence).padStart(12, '0')}`;
        const prior = [...entries.values()].filter((entry) => entry.componentId === componentId);
        const revision = prior.length + 1;
        const entry = {
          revisionId,
          componentId,
          revision,
          component: { ...body.component, id: revisionId },
        };
        entries.set(revisionId, entry);
        return { status: 201, json: entry };
      }
      const match = path.match(new RegExp(`^${VECTOR_CATALOG_ROUTE}/([^/]+)$`));
      if (!match) return { status: 404, json: { error: 'no route' } };
      const revisionId = decodeURIComponent(match[1]);
      if (method === 'GET') {
        const entry = entries.get(revisionId);
        if (!entry) return { status: 404, json: { error: `no catalog revision ${revisionId}` } };
        return { status: 200, json: entry };
      }
      if (method === 'PUT') {
        return { status: 405, json: { error: 'catalog revisions are immutable' } };
      }
      return { status: 405, json: { error: 'method not allowed' } };
    },
  };
}

test('publish then get by revision id', async () => {
  const transport = memoryTransport();
  const published = await publishCatalogComponent(transport, sampleComponent());
  assert.equal(published.revision, 1);
  assert.equal(published.component.id, published.revisionId);
  const loaded = await getCatalogRevision(transport, published.revisionId);
  assert.equal(loaded.component.name, 'Pump block');
  assert.equal(loaded.revisionId, published.revisionId);
});

test('list returns published revisions for host/UI consumption', async () => {
  const transport = memoryTransport();
  const first = await publishCatalogComponent(transport, sampleComponent({ name: 'A' }));
  const second = await publishCatalogComponent(transport, sampleComponent({ name: 'B' }));
  const listed = await listCatalogRevisions(transport);
  assert.equal(listed.length, 2);
  assert.deepEqual(
    new Set(listed.map((entry) => entry.revisionId)),
    new Set([first.revisionId, second.revisionId]),
  );
});

test('invalid component is rejected before the transport runs', async () => {
  const transport = memoryTransport();
  await assert.rejects(
    () => publishCatalogComponent(transport, sampleComponent({ provenance: 'fabricated' })),
    (error) => {
      assert.ok(error instanceof VectorCatalogClientError);
      assert.equal(error.code, 'invalid');
      return true;
    },
  );
  assert.equal(transport.calls.length, 0);
});

test('missing revision id surfaces as not_found', async () => {
  const transport = memoryTransport();
  await assert.rejects(
    () => getCatalogRevision(transport, '00000000-0000-4000-8000-000000000000'),
    (error) => error instanceof VectorCatalogClientError && error.code === 'not_found',
  );
});

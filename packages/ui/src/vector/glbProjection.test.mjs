import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const temporary = await mkdtemp(join(tmpdir(), 'text-to-cad-glb-projection-'));
const output = join(temporary, 'glb-projection.mjs');
await build({
  entryPoints: [fileURLToPath(new URL('./glbProjection.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: output,
});
const { createProjectionLoadingManager } = await import(pathToFileURL(output).href);
after(() => rm(temporary, { recursive: true, force: true }));

test('GLB projection allows embedded resources and rejects every external dependency', () => {
  const manager = createProjectionLoadingManager();
  assert.equal(manager.resolveURL('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
  assert.equal(manager.resolveURL('blob:http://cad.local/asset'), 'blob:http://cad.local/asset');
  for (const url of ['texture.png', '/api/v1/server', '//attacker.example/a.bin', 'https://attacker.example/a.bin']) {
    assert.throws(() => manager.resolveURL(url), /self-contained GLB/);
  }
});

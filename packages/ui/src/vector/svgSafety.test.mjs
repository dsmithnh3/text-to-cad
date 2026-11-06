import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const temporary = await mkdtemp(join(tmpdir(), 'text-to-cad-svg-safety-'));
const output = join(temporary, 'svg-safety.mjs');
await build({
  entryPoints: [fileURLToPath(new URL('./svgSafety.ts', import.meta.url))],
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
const { isolateSvg, sanitizeSvg } = await import(pathToFileURL(output).href);
after(async () => {
  dom.window.close();
  await rm(temporary, { recursive: true, force: true });
});

test('untrusted SVG keeps declared fragments but drops host CSS and external references', () => {
  const safe = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" onload="steal()">
    <style>html,body,.vs-root{display:none!important}</style>
    <defs><path id="shape" d="M0 0h10v10z"/><linearGradient id="paint"/></defs>
    <use href="#shape" fill="url(#paint)"/>
    <use href="https://attacker.example/a.svg#shape"/>
    <path style="background:url(https://attacker.example/pixel)" filter="url(#host-filter)"/>
  </svg>`);
  assert.doesNotMatch(safe, /<style|onload|attacker\.example|host-filter/);
  assert.match(safe, /href="#shape"/);
  assert.match(safe, /fill="url\(#paint\)"/);
});

test('instance isolation rewrites IDs and all surviving local references', () => {
  const isolated = isolateSvg(sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg">
    <defs><path id="shape"/><clipPath id="clip"><use href="#shape"/></clipPath></defs>
    <use href="#shape" clip-path="url(#clip)"/>
  </svg>`), 'instance-a');
  assert.match(isolated, /id="instance-a-shape"/);
  assert.match(isolated, /id="instance-a-clip"/);
  assert.equal((isolated.match(/href="#instance-a-shape"/g) ?? []).length, 2);
  assert.match(isolated, /clip-path="url\(#instance-a-clip\)"/);
  assert.doesNotMatch(isolated, /(?:href="#shape"|url\(#clip\))/);
});

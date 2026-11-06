/**
 * Conformance for the Vector Studio project contract. Cases live in
 * vectorProject.conformance.json so Python Task 6 can assert the same accept/reject set.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  MAX_AGGREGATE_SVG_BYTES,
  MAX_ASSET_COUNT,
  MAX_DIMENSION,
  MAX_ITEM_COUNT,
  MAX_PROJECT_BYTES,
  parseVectorProject,
  VectorProjectError,
} from './vectorProject.js';

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL('./vectorProject.conformance.json', import.meta.url)), 'utf8'),
);

function encode(value) {
  return JSON.stringify(value);
}

function baseProject(overrides = {}) {
  const minimal = FIXTURE.validProjects.find((entry) => entry.id === 'minimal').project;
  return {
    ...minimal,
    assets: minimal.assets.map((asset) => ({ ...asset })),
    items: minimal.items.map((item) => ({ ...item })),
    ...overrides,
  };
}

function buildBudgetCase(build) {
  const { tinySvg } = FIXTURE;
  switch (build) {
    case 'exact_counts_and_dimensions': {
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
      return encode(baseProject({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        assets,
        items,
      }));
    }
    case 'over_project_bytes': {
      const padding = 'x'.repeat(MAX_PROJECT_BYTES);
      return encode(baseProject({ name: padding }));
    }
    case 'one_past_asset_count': {
      const assets = Array.from({ length: MAX_ASSET_COUNT + 1 }, (_, index) => ({
        id: `a${index}`,
        name: `A${index}`,
        category: 'Test',
        svg: tinySvg,
        provenance: 'user-import',
      }));
      return encode(baseProject({ assets, items: [] }));
    }
    case 'one_past_item_count': {
      const items = Array.from({ length: MAX_ITEM_COUNT + 1 }, (_, index) => ({
        id: `i${index}`,
        assetId: 'a1',
        name: `I${index}`,
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        rotate: 0,
        opacity: 1,
        hidden: false,
        locked: false,
      }));
      return encode(baseProject({ items }));
    }
    case 'one_past_aggregate_svg_bytes': {
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
      return encode(baseProject({ assets, items: [] }));
    }
    default:
      throw new Error(`Unknown budget build: ${build}`);
  }
}

test('exported budgets match the shared conformance fixture', () => {
  assert.deepEqual(
    {
      MAX_PROJECT_BYTES,
      MAX_ASSET_COUNT,
      MAX_ITEM_COUNT,
      MAX_AGGREGATE_SVG_BYTES,
      MAX_DIMENSION,
    },
    FIXTURE.budgets,
  );
  assert.equal(FIXTURE.schemaId, 'cad-vector-studio/v1');
});

test('accepts every validProjects fixture case', () => {
  assert.ok(FIXTURE.validProjects.length >= 2);
  for (const entry of FIXTURE.validProjects) {
    const parsed = parseVectorProject(encode(entry.project));
    assert.equal(parsed.schema, FIXTURE.schemaId, entry.id);
    assert.equal(parsed.name, entry.project.name, entry.id);
    assert.equal(parsed.assets.length, entry.project.assets.length, entry.id);
    assert.equal(parsed.items.length, entry.project.items.length, entry.id);
  }
});

test('rejects every invalidProjects fixture case', () => {
  assert.ok(FIXTURE.invalidProjects.length >= 5);
  for (const entry of FIXTURE.invalidProjects) {
    const text = Object.prototype.hasOwnProperty.call(entry, 'text')
      ? entry.text
      : encode(entry.project);
    assert.throws(
      () => parseVectorProject(text),
      (error) => {
        assert.ok(error instanceof VectorProjectError, entry.id);
        assert.match(error.message, new RegExp(entry.messagePattern, 'i'), entry.id);
        return true;
      },
      entry.id,
    );
  }
});

test('budgetCases lock exact-limit accept and one-past reject semantics', () => {
  assert.ok(FIXTURE.budgetCases.length >= 5);
  for (const entry of FIXTURE.budgetCases) {
    const text = buildBudgetCase(entry.build);
    if (entry.expect === 'accept') {
      const parsed = parseVectorProject(text);
      assert.equal(parsed.assets.length, MAX_ASSET_COUNT, entry.id);
      assert.equal(parsed.items.length, MAX_ITEM_COUNT, entry.id);
      assert.equal(parsed.width, MAX_DIMENSION, entry.id);
      continue;
    }
    assert.equal(entry.expect, 'reject', entry.id);
    assert.throws(
      () => parseVectorProject(text),
      (error) => {
        assert.ok(error instanceof VectorProjectError, entry.id);
        assert.match(error.message, new RegExp(entry.messagePattern, 'i'), entry.id);
        return true;
      },
      entry.id,
    );
  }
});

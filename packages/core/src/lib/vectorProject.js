/**
 * Bounded Vector Studio project parse/validate. Untrusted JSON must fail before
 * the workspace commits it to history, persistence, or render work.
 *
 * Budgets and accept/reject cases are locked by vectorProject.conformance.json
 * (TypeScript here; Python Task 6 must load the same fixture).
 */

export const MAX_PROJECT_BYTES = 8_000_000;
export const MAX_ASSET_COUNT = 500;
export const MAX_ITEM_COUNT = 2_000;
export const MAX_AGGREGATE_SVG_BYTES = 6_000_000;
export const MAX_DIMENSION = 100_000;

export class VectorProjectError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VectorProjectError';
  }
}

function utf8Bytes(text) {
  return new TextEncoder().encode(text).length;
}

function requireFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new VectorProjectError(`Non-finite ${label}`);
  }
  return value;
}

function requirePositiveSize(value, label) {
  const number = requireFinite(value, label);
  if (!(number > 0) || number > MAX_DIMENSION) {
    throw new VectorProjectError(`Invalid ${label}`);
  }
  return number;
}

function requireDimension(value, label) {
  const number = requireFinite(value, label);
  if (!(number > 0) || number > MAX_DIMENSION) {
    throw new VectorProjectError(`Invalid ${label}`);
  }
  return number;
}

function requireString(value, label) {
  if (typeof value !== 'string') {
    throw new VectorProjectError(`Invalid ${label}`);
  }
  return value;
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') {
    throw new VectorProjectError(`Invalid ${label}`);
  }
  return value;
}

function parseAsset(raw, index) {
  if (!raw || typeof raw !== 'object') {
    throw new VectorProjectError(`Invalid asset at ${index}`);
  }
  const provenance = raw.provenance;
  if (provenance !== 'user-import' && provenance !== 'source-derived') {
    throw new VectorProjectError(`Invalid asset provenance at ${index}`);
  }
  return {
    id: requireString(raw.id, `asset.id[${index}]`),
    name: requireString(raw.name, `asset.name[${index}]`),
    category: requireString(raw.category, `asset.category[${index}]`),
    svg: requireString(raw.svg, `asset.svg[${index}]`),
    provenance,
  };
}

function parseItem(raw, index) {
  if (!raw || typeof raw !== 'object') {
    throw new VectorProjectError(`Invalid item at ${index}`);
  }
  return {
    id: requireString(raw.id, `item.id[${index}]`),
    assetId: requireString(raw.assetId, `item.assetId[${index}]`),
    name: requireString(raw.name, `item.name[${index}]`),
    x: requireFinite(raw.x, `item.x[${index}]`),
    y: requireFinite(raw.y, `item.y[${index}]`),
    w: requirePositiveSize(raw.w, `item.w[${index}]`),
    h: requirePositiveSize(raw.h, `item.h[${index}]`),
    rotate: requireFinite(raw.rotate, `item.rotate[${index}]`),
    opacity: requireFinite(raw.opacity, `item.opacity[${index}]`),
    hidden: requireBoolean(raw.hidden, `item.hidden[${index}]`),
    locked: requireBoolean(raw.locked, `item.locked[${index}]`),
  };
}

export function parseVectorProject(text) {
  if (typeof text !== 'string') {
    throw new VectorProjectError('Project text must be a string');
  }
  if (utf8Bytes(text) > MAX_PROJECT_BYTES) {
    throw new VectorProjectError(`Project exceeds MAX_PROJECT_BYTES (${MAX_PROJECT_BYTES})`);
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new VectorProjectError('Malformed project JSON');
  }
  if (!raw || typeof raw !== 'object') {
    throw new VectorProjectError('Project must be an object');
  }
  if (raw.schema !== 'cad-vector-studio/v1') {
    throw new VectorProjectError('Unsupported project schema');
  }
  if (!Array.isArray(raw.assets)) {
    throw new VectorProjectError('Project assets must be an array');
  }
  if (!Array.isArray(raw.items)) {
    throw new VectorProjectError('Project items must be an array');
  }
  if (raw.assets.length > MAX_ASSET_COUNT) {
    throw new VectorProjectError(`Asset count exceeds MAX_ASSET_COUNT (${MAX_ASSET_COUNT})`);
  }
  if (raw.items.length > MAX_ITEM_COUNT) {
    throw new VectorProjectError(`Item count exceeds MAX_ITEM_COUNT (${MAX_ITEM_COUNT})`);
  }

  const assets = raw.assets.map(parseAsset);
  let aggregateSvgBytes = 0;
  for (const asset of assets) {
    aggregateSvgBytes += utf8Bytes(asset.svg);
    if (aggregateSvgBytes > MAX_AGGREGATE_SVG_BYTES) {
      throw new VectorProjectError(
        `Aggregate SVG bytes exceed MAX_AGGREGATE_SVG_BYTES (${MAX_AGGREGATE_SVG_BYTES})`,
      );
    }
  }

  const items = raw.items.map(parseItem);
  return {
    schema: 'cad-vector-studio/v1',
    name: requireString(raw.name, 'name'),
    width: requireDimension(raw.width, 'width'),
    height: requireDimension(raw.height, 'height'),
    assets,
    items,
  };
}

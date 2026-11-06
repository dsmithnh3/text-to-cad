/**
 * Bounded Vector Studio project parse/validate. Untrusted JSON must fail before
 * the workspace commits it to history, persistence, or render work.
 */

export const MAX_PROJECT_BYTES = 8_000_000;
export const MAX_ASSET_COUNT = 500;
export const MAX_ITEM_COUNT = 2_000;
export const MAX_AGGREGATE_SVG_BYTES = 6_000_000;
export const MAX_DIMENSION = 100_000;

export type VectorProvenance = 'user-import' | 'source-derived';

export type VectorAsset = {
  id: string;
  name: string;
  category: string;
  svg: string;
  provenance: VectorProvenance;
};

export type VectorItem = {
  id: string;
  assetId: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotate: number;
  opacity: number;
  hidden: boolean;
  locked: boolean;
};

export type VectorProject = {
  schema: 'cad-vector-studio/v1';
  name: string;
  items: VectorItem[];
  assets: VectorAsset[];
  width: number;
  height: number;
};

export class VectorProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VectorProjectError';
  }
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

function requireFinite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new VectorProjectError(`Non-finite ${label}`);
  }
  return value;
}

function requirePositiveSize(value: unknown, label: string): number {
  const number = requireFinite(value, label);
  if (!(number > 0) || number > MAX_DIMENSION) {
    throw new VectorProjectError(`Invalid ${label}`);
  }
  return number;
}

function requireDimension(value: unknown, label: string): number {
  const number = requireFinite(value, label);
  if (!(number > 0) || number > MAX_DIMENSION) {
    throw new VectorProjectError(`Invalid ${label}`);
  }
  return number;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new VectorProjectError(`Invalid ${label}`);
  }
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new VectorProjectError(`Invalid ${label}`);
  }
  return value;
}

function parseAsset(raw: unknown, index: number): VectorAsset {
  if (!raw || typeof raw !== 'object') {
    throw new VectorProjectError(`Invalid asset at ${index}`);
  }
  const asset = raw as Record<string, unknown>;
  const provenance = asset.provenance;
  if (provenance !== 'user-import' && provenance !== 'source-derived') {
    throw new VectorProjectError(`Invalid asset provenance at ${index}`);
  }
  return {
    id: requireString(asset.id, `asset.id[${index}]`),
    name: requireString(asset.name, `asset.name[${index}]`),
    category: requireString(asset.category, `asset.category[${index}]`),
    svg: requireString(asset.svg, `asset.svg[${index}]`),
    provenance,
  };
}

function parseItem(raw: unknown, index: number): VectorItem {
  if (!raw || typeof raw !== 'object') {
    throw new VectorProjectError(`Invalid item at ${index}`);
  }
  const item = raw as Record<string, unknown>;
  return {
    id: requireString(item.id, `item.id[${index}]`),
    assetId: requireString(item.assetId, `item.assetId[${index}]`),
    name: requireString(item.name, `item.name[${index}]`),
    x: requireFinite(item.x, `item.x[${index}]`),
    y: requireFinite(item.y, `item.y[${index}]`),
    w: requirePositiveSize(item.w, `item.w[${index}]`),
    h: requirePositiveSize(item.h, `item.h[${index}]`),
    rotate: requireFinite(item.rotate, `item.rotate[${index}]`),
    opacity: requireFinite(item.opacity, `item.opacity[${index}]`),
    hidden: requireBoolean(item.hidden, `item.hidden[${index}]`),
    locked: requireBoolean(item.locked, `item.locked[${index}]`),
  };
}

export function parseVectorProject(text: string): VectorProject {
  if (typeof text !== 'string') {
    throw new VectorProjectError('Project text must be a string');
  }
  if (utf8Bytes(text) > MAX_PROJECT_BYTES) {
    throw new VectorProjectError(`Project exceeds MAX_PROJECT_BYTES (${MAX_PROJECT_BYTES})`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new VectorProjectError('Malformed project JSON');
  }
  if (!raw || typeof raw !== 'object') {
    throw new VectorProjectError('Project must be an object');
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.schema !== 'cad-vector-studio/v1') {
    throw new VectorProjectError('Unsupported project schema');
  }
  if (!Array.isArray(candidate.assets)) {
    throw new VectorProjectError('Project assets must be an array');
  }
  if (!Array.isArray(candidate.items)) {
    throw new VectorProjectError('Project items must be an array');
  }
  if (candidate.assets.length > MAX_ASSET_COUNT) {
    throw new VectorProjectError(`Asset count exceeds MAX_ASSET_COUNT (${MAX_ASSET_COUNT})`);
  }
  if (candidate.items.length > MAX_ITEM_COUNT) {
    throw new VectorProjectError(`Item count exceeds MAX_ITEM_COUNT (${MAX_ITEM_COUNT})`);
  }

  const assets = candidate.assets.map(parseAsset);
  let aggregateSvgBytes = 0;
  for (const asset of assets) {
    aggregateSvgBytes += utf8Bytes(asset.svg);
    if (aggregateSvgBytes > MAX_AGGREGATE_SVG_BYTES) {
      throw new VectorProjectError(
        `Aggregate SVG bytes exceed MAX_AGGREGATE_SVG_BYTES (${MAX_AGGREGATE_SVG_BYTES})`,
      );
    }
  }

  const items = candidate.items.map(parseItem);
  return {
    schema: 'cad-vector-studio/v1',
    name: requireString(candidate.name, 'name'),
    width: requireDimension(candidate.width, 'width'),
    height: requireDimension(candidate.height, 'height'),
    assets,
    items,
  };
}

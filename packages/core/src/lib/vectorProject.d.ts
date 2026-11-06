/** Bounded Vector Studio project parse/validate. Budgets match vectorProject.conformance.json. */

export const MAX_PROJECT_BYTES: 8_000_000;
export const MAX_ASSET_COUNT: 500;
export const MAX_ITEM_COUNT: 2_000;
export const MAX_AGGREGATE_SVG_BYTES: 6_000_000;
export const MAX_DIMENSION: 100_000;

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

export declare class VectorProjectError extends Error {
  constructor(message: string);
}

export declare function parseVectorProject(text: string): VectorProject;

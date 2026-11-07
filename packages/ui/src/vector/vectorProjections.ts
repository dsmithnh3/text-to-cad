/**
 * Client adapter for immutable CAD-accurate projection asset revisions.
 * Orthographic / isometric OCCT HLR exports live under `/api/v1/vector/projections`.
 * Distinct from illustrative GLB mesh projection in the browser.
 */
import type { VectorAsset } from './vectorProject.js';

export const VECTOR_PROJECTIONS_ROUTE = '/api/v1/vector/projections';

/** Views the viewer offers for one-click CAD→Vector publish. */
export const PROJECTION_PUBLISH_VIEWS = [
  { view: 'iso', labelKey: 'export.projection.iso' },
  { view: 'front', labelKey: 'export.projection.front' },
  { view: 'top', labelKey: 'export.projection.top' },
  { view: 'right', labelKey: 'export.projection.right' },
] as const;

export type ProjectionPublishView = (typeof PROJECTION_PUBLISH_VIEWS)[number]['view'];

export type VectorProjectionProvenance = {
  kind: string;
  backend: string;
  view: string;
  viewClass: string;
  hiddenLines: boolean;
  source: {
    path?: string;
    documentId?: string;
    documentRevision?: string;
  };
};

export type VectorProjectionEntry = {
  revisionId: string;
  assetId: string;
  revision: number;
  asset: VectorAsset;
  projection: VectorProjectionProvenance;
};

export type VectorProjectionPublishInput = {
  file?: string;
  documentId?: string;
  documentRevision?: string;
  view: string;
  hiddenLines?: boolean;
  name?: string;
  assetId?: string;
};

export type VectorProjectionErrorCode = 'invalid' | 'not_found' | 'stale' | 'transport';

export class VectorProjectionClientError extends Error {
  readonly code: VectorProjectionErrorCode;
  readonly status?: number;
  readonly currentRevision?: number;

  constructor(
    code: VectorProjectionErrorCode,
    message: string,
    options: { status?: number; currentRevision?: number } = {},
  ) {
    super(message);
    this.name = 'VectorProjectionClientError';
    this.code = code;
    this.status = options.status;
    this.currentRevision = options.currentRevision;
  }
}

export type VectorProjectionResponse = {
  status: number;
  json: unknown;
};

export type VectorProjectionTransport = {
  request(method: string, path: string, body?: unknown): Promise<VectorProjectionResponse>;
};

function asEntry(json: unknown): VectorProjectionEntry {
  if (!json || typeof json !== 'object') {
    throw new VectorProjectionClientError('transport', 'Server returned a non-object projection entry');
  }
  const record = json as Record<string, unknown>;
  if (
    typeof record.revisionId !== 'string' ||
    typeof record.assetId !== 'string' ||
    typeof record.revision !== 'number'
  ) {
    throw new VectorProjectionClientError('transport', 'Server projection entry missing ids or revision');
  }
  const asset = record.asset;
  const projection = record.projection;
  if (!asset || typeof asset !== 'object' || !projection || typeof projection !== 'object') {
    throw new VectorProjectionClientError('transport', 'Server projection entry missing asset or projection');
  }
  const a = asset as Record<string, unknown>;
  if (
    typeof a.id !== 'string' ||
    typeof a.name !== 'string' ||
    typeof a.category !== 'string' ||
    typeof a.svg !== 'string' ||
    (a.provenance !== 'user-import' && a.provenance !== 'source-derived')
  ) {
    throw new VectorProjectionClientError('transport', 'Server projection asset shape is invalid');
  }
  return {
    revisionId: record.revisionId,
    assetId: record.assetId,
    revision: record.revision,
    asset: {
      id: a.id,
      name: a.name,
      category: a.category,
      svg: a.svg,
      provenance: a.provenance,
    },
    projection: projection as VectorProjectionProvenance,
  };
}

function raiseFromResponse(status: number, json: unknown): never {
  const error =
    json && typeof json === 'object' && 'error' in json && typeof (json as { error: unknown }).error === 'string'
      ? (json as { error: string }).error
      : `Vector projection request failed (${status})`;
  const currentRevision =
    json && typeof json === 'object' && 'currentRevision' in json && typeof (json as { currentRevision: unknown }).currentRevision === 'number'
      ? (json as { currentRevision: number }).currentRevision
      : undefined;
  if (status === 400) {
    throw new VectorProjectionClientError('invalid', error, { status });
  }
  if (status === 404) {
    throw new VectorProjectionClientError('not_found', error, { status });
  }
  if (status === 409) {
    throw new VectorProjectionClientError('stale', error, { status, currentRevision });
  }
  throw new VectorProjectionClientError('transport', error, { status, currentRevision });
}

/** Publish a CAD-accurate projection from a STEP/XBF path and/or held document id. */
export async function publishProjection(
  transport: VectorProjectionTransport,
  input: VectorProjectionPublishInput,
): Promise<VectorProjectionEntry> {
  if (!input || typeof input !== 'object') {
    throw new VectorProjectionClientError('invalid', 'projection publish input must be an object');
  }
  if (typeof input.view !== 'string' || !input.view) {
    throw new VectorProjectionClientError('invalid', 'view must be a non-empty string');
  }
  if (!input.file && !input.documentId) {
    throw new VectorProjectionClientError('invalid', 'file or documentId is required');
  }
  const body: Record<string, unknown> = { view: input.view };
  if (input.file) body.file = input.file;
  if (input.documentId) body.documentId = input.documentId;
  if (input.documentRevision) body.documentRevision = input.documentRevision;
  if (input.hiddenLines !== undefined) body.hiddenLines = input.hiddenLines;
  if (input.name) body.name = input.name;
  if (input.assetId) body.assetId = input.assetId;
  const response = await transport.request('POST', VECTOR_PROJECTIONS_ROUTE, body);
  if (response.status !== 201) raiseFromResponse(response.status, response.json);
  return asEntry(response.json);
}

export async function getProjectionRevision(
  transport: VectorProjectionTransport,
  revisionId: string,
): Promise<VectorProjectionEntry> {
  if (typeof revisionId !== 'string' || !revisionId) {
    throw new VectorProjectionClientError('invalid', 'revisionId must be a non-empty string');
  }
  const response = await transport.request(
    'GET',
    `${VECTOR_PROJECTIONS_ROUTE}/${encodeURIComponent(revisionId)}`,
  );
  if (response.status !== 200) raiseFromResponse(response.status, response.json);
  return asEntry(response.json);
}

export async function listProjectionRevisions(
  transport: VectorProjectionTransport,
): Promise<VectorProjectionEntry[]> {
  const response = await transport.request('GET', VECTOR_PROJECTIONS_ROUTE);
  if (response.status !== 200) raiseFromResponse(response.status, response.json);
  const json = response.json;
  if (!json || typeof json !== 'object' || !Array.isArray((json as { entries?: unknown }).entries)) {
    throw new VectorProjectionClientError('transport', 'Server returned a non-list projection payload');
  }
  return (json as { entries: unknown[] }).entries.map(asEntry);
}

export async function regenerateProjection(
  transport: VectorProjectionTransport,
  revisionId: string,
  expectedRevision: number,
  name?: string,
): Promise<VectorProjectionEntry> {
  if (typeof revisionId !== 'string' || !revisionId) {
    throw new VectorProjectionClientError('invalid', 'revisionId must be a non-empty string');
  }
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new VectorProjectionClientError('invalid', 'expectedRevision must be a positive integer');
  }
  const body: Record<string, unknown> = { expectedRevision };
  if (name !== undefined) body.name = name;
  const response = await transport.request(
    'POST',
    `${VECTOR_PROJECTIONS_ROUTE}/${encodeURIComponent(revisionId)}/regenerate`,
    body,
  );
  if (response.status !== 201) raiseFromResponse(response.status, response.json);
  return asEntry(response.json);
}

/** Browser/tunnel fetch transport with the viewer mutation guard header. */
export function createBrowserVectorProjectionTransport(
  fetchImpl: typeof fetch = fetch,
  options: { origin?: string } = {},
): VectorProjectionTransport {
  const origin = options.origin?.replace(/\/$/, '') ?? '';
  return {
    async request(method, path, body) {
      const url = origin && path.startsWith('/') ? `${origin}${path}` : path;
      const response = await fetchImpl(url, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-cad-viewer': '1',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let json: unknown = null;
      const text = await response.text();
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = { error: text };
        }
      }
      return { status: response.status, json };
    },
  };
}

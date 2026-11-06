/**
 * Client adapter for the immutable Vector Studio component catalog.
 * Hosts and UI look up published components by revisionId. Publish
 * validates component shape before the transport runs; there is no update
 * path — a new publish allocates a new revision id.
 */
import type { VectorAsset, VectorProvenance } from './vectorProject';

export const VECTOR_CATALOG_ROUTE = '/api/v1/vector/catalog';

const PROVENANCE = new Set<VectorProvenance>(['user-import', 'source-derived']);

export type VectorCatalogComponentInput = {
  name: string;
  category: string;
  svg: string;
  provenance: VectorProvenance;
};

export type VectorCatalogEntry = {
  revisionId: string;
  componentId: string;
  revision: number;
  component: VectorAsset;
};

export type VectorCatalogErrorCode = 'invalid' | 'not_found' | 'immutable' | 'transport';

export class VectorCatalogClientError extends Error {
  readonly code: VectorCatalogErrorCode;
  readonly status?: number;

  constructor(code: VectorCatalogErrorCode, message: string, options: { status?: number } = {}) {
    super(message);
    this.name = 'VectorCatalogClientError';
    this.code = code;
    this.status = options.status;
  }
}

export type VectorCatalogResponse = {
  status: number;
  json: unknown;
};

/** Injected transport so tests can drive the adapter without a browser. */
export type VectorCatalogTransport = {
  request(method: string, path: string, body?: unknown): Promise<VectorCatalogResponse>;
};

function encodeComponent(component: VectorCatalogComponentInput): VectorCatalogComponentInput {
  if (!component || typeof component !== 'object') {
    throw new VectorCatalogClientError('invalid', 'component must be an object');
  }
  if (typeof component.name !== 'string' || !component.name) {
    throw new VectorCatalogClientError('invalid', 'component.name must be a non-empty string');
  }
  if (typeof component.category !== 'string' || !component.category) {
    throw new VectorCatalogClientError('invalid', 'component.category must be a non-empty string');
  }
  if (typeof component.svg !== 'string') {
    throw new VectorCatalogClientError('invalid', 'component.svg must be a string');
  }
  if (!PROVENANCE.has(component.provenance)) {
    throw new VectorCatalogClientError('invalid', 'Invalid component provenance');
  }
  return {
    name: component.name,
    category: component.category,
    svg: component.svg,
    provenance: component.provenance,
  };
}

function asEntry(json: unknown): VectorCatalogEntry {
  if (!json || typeof json !== 'object') {
    throw new VectorCatalogClientError('transport', 'Server returned a non-object catalog entry');
  }
  const record = json as Record<string, unknown>;
  if (
    typeof record.revisionId !== 'string' ||
    typeof record.componentId !== 'string' ||
    typeof record.revision !== 'number'
  ) {
    throw new VectorCatalogClientError('transport', 'Server catalog entry missing ids or revision');
  }
  const component = record.component;
  if (!component || typeof component !== 'object') {
    throw new VectorCatalogClientError('transport', 'Server catalog entry missing component');
  }
  const asset = component as Record<string, unknown>;
  if (
    typeof asset.id !== 'string' ||
    typeof asset.name !== 'string' ||
    typeof asset.category !== 'string' ||
    typeof asset.svg !== 'string' ||
    !PROVENANCE.has(asset.provenance as VectorProvenance)
  ) {
    throw new VectorCatalogClientError('transport', 'Server catalog component shape is invalid');
  }
  return {
    revisionId: record.revisionId,
    componentId: record.componentId,
    revision: record.revision,
    component: {
      id: asset.id,
      name: asset.name,
      category: asset.category,
      svg: asset.svg,
      provenance: asset.provenance as VectorProvenance,
    },
  };
}

function raiseFromResponse(status: number, json: unknown): never {
  const error =
    json && typeof json === 'object' && 'error' in json && typeof (json as { error: unknown }).error === 'string'
      ? (json as { error: string }).error
      : `Vector catalog request failed (${status})`;
  if (status === 400) {
    throw new VectorCatalogClientError('invalid', error, { status });
  }
  if (status === 404) {
    throw new VectorCatalogClientError('not_found', error, { status });
  }
  if (status === 405) {
    throw new VectorCatalogClientError('immutable', error, { status });
  }
  throw new VectorCatalogClientError('transport', error, { status });
}

/** Publish a component; returns the immutable catalog entry for its revision id. */
export async function publishCatalogComponent(
  transport: VectorCatalogTransport,
  component: VectorCatalogComponentInput,
  componentId?: string,
): Promise<VectorCatalogEntry> {
  const validated = encodeComponent(component);
  const body: { component: VectorCatalogComponentInput; componentId?: string } = { component: validated };
  if (componentId !== undefined) body.componentId = componentId;
  const response = await transport.request('POST', VECTOR_CATALOG_ROUTE, body);
  if (response.status !== 201) raiseFromResponse(response.status, response.json);
  return asEntry(response.json);
}

/** Read one published catalog revision by revision id (host/UI consume path). */
export async function getCatalogRevision(
  transport: VectorCatalogTransport,
  revisionId: string,
): Promise<VectorCatalogEntry> {
  if (typeof revisionId !== 'string' || !revisionId) {
    throw new VectorCatalogClientError('invalid', 'revisionId must be a non-empty string');
  }
  const response = await transport.request(
    'GET',
    `${VECTOR_CATALOG_ROUTE}/${encodeURIComponent(revisionId)}`,
  );
  if (response.status !== 200) raiseFromResponse(response.status, response.json);
  return asEntry(response.json);
}

/** List published catalog revisions for host/UI library browsing. */
export async function listCatalogRevisions(
  transport: VectorCatalogTransport,
): Promise<VectorCatalogEntry[]> {
  const response = await transport.request('GET', VECTOR_CATALOG_ROUTE);
  if (response.status !== 200) raiseFromResponse(response.status, response.json);
  const json = response.json;
  if (!json || typeof json !== 'object' || !Array.isArray((json as { entries?: unknown }).entries)) {
    throw new VectorCatalogClientError('transport', 'Server returned a non-list catalog payload');
  }
  return (json as { entries: unknown[] }).entries.map(asEntry);
}

/** Browser/tunnel fetch transport with the viewer mutation guard header. */
export function createBrowserVectorCatalogTransport(
  fetchImpl: typeof fetch = fetch,
  options: { origin?: string } = {},
): VectorCatalogTransport {
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

/**
 * Client adapter for the durable Vector Studio UUID/revision store.
 * Mutations always carry expectedRevision; invalid projects are rejected
 * with parseVectorProject before the transport is called. Client drafts
 * (vectorDraft) remain a recoverable overlay over server revisions.
 */
import { parseVectorProject, VectorProjectError, type VectorProject } from './vectorProject';

export const VECTOR_PROJECTS_ROUTE = '/api/v1/vector/projects';

export type VectorProjectDocument = {
  id: string;
  revision: number;
  project: VectorProject;
};

export type VectorProjectStoreErrorCode = 'invalid' | 'not_found' | 'stale' | 'transport';

export class VectorProjectStoreClientError extends Error {
  readonly code: VectorProjectStoreErrorCode;
  readonly status?: number;
  readonly currentRevision?: number;

  constructor(
    code: VectorProjectStoreErrorCode,
    message: string,
    options: { status?: number; currentRevision?: number } = {},
  ) {
    super(message);
    this.name = 'VectorProjectStoreClientError';
    this.code = code;
    this.status = options.status;
    this.currentRevision = options.currentRevision;
  }
}

export type VectorProjectStoreResponse = {
  status: number;
  json: unknown;
};

/** Injected transport so tests can drive the adapter without a browser. */
export type VectorProjectStoreTransport = {
  request(method: string, path: string, body?: unknown): Promise<VectorProjectStoreResponse>;
};

function encodeProject(project: VectorProject): VectorProject {
  try {
    return parseVectorProject(JSON.stringify(project));
  } catch (error) {
    const detail =
      error instanceof VectorProjectError || error instanceof Error ? error.message : String(error);
    throw new VectorProjectStoreClientError('invalid', detail);
  }
}

function asDocument(json: unknown): VectorProjectDocument {
  if (!json || typeof json !== 'object') {
    throw new VectorProjectStoreClientError('transport', 'Server returned a non-object document');
  }
  const record = json as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.revision !== 'number') {
    throw new VectorProjectStoreClientError('transport', 'Server document missing id or revision');
  }
  return {
    id: record.id,
    revision: record.revision,
    project: parseVectorProject(JSON.stringify(record.project)),
  };
}

function raiseFromResponse(status: number, json: unknown): never {
  const error =
    json && typeof json === 'object' && 'error' in json && typeof (json as { error: unknown }).error === 'string'
      ? (json as { error: string }).error
      : `Vector project store request failed (${status})`;
  const currentRevision =
    json &&
    typeof json === 'object' &&
    'currentRevision' in json &&
    typeof (json as { currentRevision: unknown }).currentRevision === 'number'
      ? (json as { currentRevision: number }).currentRevision
      : undefined;
  if (status === 400) {
    throw new VectorProjectStoreClientError('invalid', error, { status });
  }
  if (status === 404) {
    throw new VectorProjectStoreClientError('not_found', error, { status });
  }
  if (status === 409) {
    throw new VectorProjectStoreClientError('stale', error, { status, currentRevision });
  }
  throw new VectorProjectStoreClientError('transport', error, { status, currentRevision });
}

/** Create a durable project; returns the server document at revision 1. */
export async function createVectorProject(
  transport: VectorProjectStoreTransport,
  project: VectorProject,
): Promise<VectorProjectDocument> {
  const validated = encodeProject(project);
  const response = await transport.request('POST', VECTOR_PROJECTS_ROUTE, { project: validated });
  if (response.status !== 201) raiseFromResponse(response.status, response.json);
  return asDocument(response.json);
}

/** Read a durable project by UUID. */
export async function getVectorProject(
  transport: VectorProjectStoreTransport,
  id: string,
): Promise<VectorProjectDocument> {
  const response = await transport.request('GET', `${VECTOR_PROJECTS_ROUTE}/${encodeURIComponent(id)}`);
  if (response.status !== 200) raiseFromResponse(response.status, response.json);
  return asDocument(response.json);
}

/**
 * Replace a durable project when expectedRevision matches the server's.
 * Rejects invalid projects before the transport runs.
 */
export async function updateVectorProject(
  transport: VectorProjectStoreTransport,
  id: string,
  expectedRevision: number,
  project: VectorProject,
): Promise<VectorProjectDocument> {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new VectorProjectStoreClientError('invalid', 'expectedRevision must be a positive integer');
  }
  const validated = encodeProject(project);
  const response = await transport.request('PUT', `${VECTOR_PROJECTS_ROUTE}/${encodeURIComponent(id)}`, {
    expectedRevision,
    project: validated,
  });
  if (response.status !== 200) raiseFromResponse(response.status, response.json);
  return asDocument(response.json);
}

/** Browser/tunnel fetch transport with the viewer mutation guard header. */
export function createBrowserVectorProjectTransport(
  fetchImpl: typeof fetch = fetch,
  options: { origin?: string } = {},
): VectorProjectStoreTransport {
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

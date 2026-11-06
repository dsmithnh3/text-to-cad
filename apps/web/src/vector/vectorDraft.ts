/**
 * Versioned Vector Studio draft persistence. Client drafts recover over the
 * eventual server UUID/revision store; only committed reducer revisions are
 * written, and Task 1 validation rejects over-budget payloads at this boundary.
 */
import { parseVectorProject, VectorProjectError, type VectorProject } from './vectorProject';
import type { VectorEditorAction } from './vectorState';

/** Session key kept from the pre-adapter workspace so open tabs still restore. */
export const VECTOR_DRAFT_KEY = 'cad-vector-studio-project-v1';
export const VECTOR_DRAFT_VERSION = 1;

export type VectorDraftStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type VectorDraftWriteResult =
  | { ok: true }
  | { ok: false; error: 'quota' | 'blocked' | 'invalid'; message: string };

type DraftEnvelope = {
  version: number;
  project: unknown;
};

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error ? String(error.name) : '';
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  if ('code' in error && (error.code === 22 || error.code === 1014)) return true;
  return /quota/i.test(String('message' in error ? error.message : error));
}

function encodeDraft(project: VectorProject): string {
  const envelope: DraftEnvelope = { version: VECTOR_DRAFT_VERSION, project };
  return JSON.stringify(envelope);
}

function decodeDraft(raw: string): unknown {
  const parsed: unknown = JSON.parse(raw);
  if (
    parsed &&
    typeof parsed === 'object' &&
    'version' in parsed &&
    'project' in parsed &&
    (parsed as DraftEnvelope).version === VECTOR_DRAFT_VERSION
  ) {
    return (parsed as DraftEnvelope).project;
  }
  // Legacy bare project JSON under the same key.
  return parsed;
}

/** Restore a validated project, or `null` when missing / invalid / over budget. */
export function readVectorDraft(storage: VectorDraftStorage): VectorProject | null {
  try {
    const raw = storage.getItem(VECTOR_DRAFT_KEY);
    if (!raw) return null;
    return parseVectorProject(JSON.stringify(decodeDraft(raw)));
  } catch {
    return null;
  }
}

/** Validate then write. Never throws; quota and blocked stores report failure. */
export function writeVectorDraft(
  storage: VectorDraftStorage,
  project: VectorProject,
): VectorDraftWriteResult {
  let payload: string;
  try {
    payload = encodeDraft(parseVectorProject(JSON.stringify(project)));
  } catch (error) {
    const message = error instanceof VectorProjectError || error instanceof Error
      ? error.message
      : String(error);
    return { ok: false, error: 'invalid', message };
  }
  try {
    storage.setItem(VECTOR_DRAFT_KEY, payload);
    return { ok: true };
  } catch (error) {
    if (isQuotaError(error)) {
      return {
        ok: false,
        error: 'quota',
        message: 'Draft could not be saved: storage quota exceeded',
      };
    }
    return {
      ok: false,
      error: 'blocked',
      message: 'Draft could not be saved: storage unavailable',
    };
  }
}

/** Drag / ephemeral preview updates are not drafts. */
export function shouldPersistVectorDraft(action: VectorEditorAction): boolean {
  return action.type !== 'preview';
}

/**
 * Persist only after a committed reducer revision. Returns `null` when the
 * action is ephemeral; otherwise the write result.
 */
export function persistCommittedDraft(
  storage: VectorDraftStorage,
  action: VectorEditorAction,
  project: VectorProject,
): VectorDraftWriteResult | null {
  if (!shouldPersistVectorDraft(action)) return null;
  return writeVectorDraft(storage, project);
}

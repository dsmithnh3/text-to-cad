/** Re-export shared draft helpers from `@cad/ui/vector`. */
export {
  VECTOR_DRAFT_KEY,
  VECTOR_DRAFT_VERSION,
  persistCommittedDraft,
  readVectorDraft,
  shouldPersistVectorDraft,
  writeVectorDraft,
} from '@cad/ui/vector';
export type { VectorDraftStorage, VectorDraftWriteResult } from '@cad/ui/vector';

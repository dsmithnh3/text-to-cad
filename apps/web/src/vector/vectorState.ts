/**
 * Transactional Vector Studio history. One user action → one past entry.
 * Drag previews update the live project without pushing history; pointer-up
 * commits with the pre-drag snapshot as the undo target (`baseline`).
 */
import type { VectorProject } from './vectorProject';

export const MAX_HISTORY = 50;

export type VectorEditorState = {
  project: VectorProject;
  past: VectorProject[];
  future: VectorProject[];
};

export type VectorEditorAction =
  | { type: 'replace'; project: VectorProject }
  | { type: 'preview'; project: VectorProject }
  | {
      type: 'commit';
      project: VectorProject;
      /** When set (drag commit), push this pre-drag snapshot instead of the live project. */
      baseline?: VectorProject;
    }
  | { type: 'undo' }
  | { type: 'redo' };

export function createVectorState(project: VectorProject): VectorEditorState {
  return { project, past: [], future: [] };
}

function pushPast(past: VectorProject[], snapshot: VectorProject): VectorProject[] {
  return [...past.slice(-(MAX_HISTORY - 1)), snapshot];
}

export function reduceVectorState(
  state: VectorEditorState,
  action: VectorEditorAction,
): VectorEditorState {
  switch (action.type) {
    case 'replace':
      return { project: action.project, past: [], future: [] };
    case 'preview':
      return { ...state, project: action.project };
    case 'commit': {
      const snapshot = action.baseline ?? state.project;
      return {
        project: action.project,
        past: pushPast(state.past, snapshot),
        future: [],
      };
    }
    case 'undo': {
      if (!state.past.length) return state;
      const previous = state.past[state.past.length - 1]!;
      return {
        project: previous,
        past: state.past.slice(0, -1),
        future: [...state.future, state.project],
      };
    }
    case 'redo': {
      if (!state.future.length) return state;
      const next = state.future[state.future.length - 1]!;
      return {
        project: next,
        past: pushPast(state.past, state.project),
        future: state.future.slice(0, -1),
      };
    }
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

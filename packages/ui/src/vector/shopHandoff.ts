/**
 * Seed prompts that hand a CAD model to manufacturing skills.
 * Projected SVG stays composition-only; these prompts name the CAD source,
 * never treat Vector SVG as a shop drawing.
 */

export type ShopHandoffKind = 'engineering-drawing' | 'dxf';

export type ShopHandoffSource = {
  /** Absolute STEP/XBF path when known. */
  path?: string;
  /** Engine document id when the model is held without a path. */
  documentId?: string;
  documentRevision?: string;
  /** Optional published projection revision the person was looking at. */
  projectionRevisionId?: string;
  /** Human label for the model (file stem). */
  name?: string;
};

export type ShopHandoffRequest = ShopHandoffSource & {
  kind: ShopHandoffKind;
};

const SKILL: Record<ShopHandoffKind, string> = {
  'engineering-drawing': 'engineering-drawing',
  dxf: 'dxf',
};

/** Build the clipboard / agent prompt for a shop-drawing or DXF handoff. */
export function formatShopHandoffPrompt(request: ShopHandoffRequest): string {
  const skill = SKILL[request.kind];
  const label = request.name?.trim() || 'the current CAD model';
  const lines: string[] = [
    `Use the $${skill} skill on the CAD model (not on Vector Studio SVG).`,
    `Model: ${label}`,
  ];
  if (request.path) {
    lines.push(`Source file (absolute): ${request.path}`);
  }
  if (request.documentId) {
    lines.push(`Document id: ${request.documentId}`);
  }
  if (request.documentRevision) {
    lines.push(`Document revision: ${request.documentRevision}`);
  }
  if (request.projectionRevisionId) {
    lines.push(
      `Context: Vector Studio has CAD-accurate projection revision ${request.projectionRevisionId}; regenerate or compose SVG there if needed, but produce the ${request.kind === 'dxf' ? 'cut DXF' : 'dimensioned engineering drawing'} from the CAD model above.`,
    );
  } else {
    lines.push(
      request.kind === 'dxf'
        ? 'Produce a validated 2D DXF cut layout / flat pattern from this CAD model.'
        : 'Produce a dimensioned engineering drawing PDF from this CAD model.',
    );
  }
  lines.push('Do not treat illustrative GLB mesh SVG or Vector composition as manufacturing geometry.');
  return lines.join('\n');
}

/** True when enough CAD identity is present to seed a handoff. */
export function canShopHandoff(source: ShopHandoffSource): boolean {
  return Boolean((source.path && source.path.length > 0) || (source.documentId && source.documentId.length > 0));
}

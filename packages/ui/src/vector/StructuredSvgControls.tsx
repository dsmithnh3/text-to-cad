import { useEffect, useMemo, useState } from 'react';
import {
  findSvgAstNodeById,
  listSvgAstEntries,
  parseSvgAst,
  patchStructuredAttrs,
  patchStructuredPathD,
  pathCommandsToD,
  structuredAttrsFor,
  type SvgAstNode,
} from './svgStructuredControls.js';

export type StructuredSvgControlsProps = {
  svg: string;
  /** Locale translator (`translator(locale)`). */
  tr: (key: string) => string;
  /** Called with the next asset.svg string after a structured edit. */
  onSvgChange: (nextSvg: string) => void;
  disabled?: boolean;
};

/**
 * Inspector panel: editable AST node tree + attribute / path controls.
 * Opaque nodes are listed but not rewritten.
 */
export default function StructuredSvgControls({
  svg,
  tr,
  onSvgChange,
  disabled = false,
}: StructuredSvgControlsProps) {
  const parsed = useMemo(() => {
    try {
      return parseSvgAst(svg);
    } catch {
      return null;
    }
  }, [svg]);
  const entries = useMemo(() => (parsed ? listSvgAstEntries(parsed) : []), [parsed]);
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => {
    if (!parsed) {
      setSelectedId('');
      return;
    }
    if (selectedId && findSvgAstNodeById(parsed, selectedId)) return;
    const firstEditable = entries.find((entry) => entry.editable);
    setSelectedId(firstEditable?.id ?? entries[0]?.id ?? '');
  }, [parsed, entries, selectedId]);

  const selected: SvgAstNode | null = parsed && selectedId
    ? findSvgAstNodeById(parsed, selectedId)
    : null;

  if (!parsed) {
    return <p className="vs-muted">{tr('vector.structuredParseFailed')}</p>;
  }

  const onAttr = (name: string, value: string) => {
    if (disabled || !selected || selected.kind !== 'editable') return;
    const result = patchStructuredAttrs(svg, selected.id, { [name]: value });
    onSvgChange(result.svg);
  };

  const onPathD = (value: string) => {
    if (disabled || !selected || selected.kind !== 'editable' || selected.tag !== 'path') return;
    const result = patchStructuredPathD(svg, selected.id, value);
    onSvgChange(result.svg);
  };

  const attrNames = selected?.kind === 'editable' ? structuredAttrsFor(selected.tag) : [];
  const pathD = selected?.kind === 'editable' && selected.tag === 'path'
    ? (selected.commands ? pathCommandsToD(selected.commands) : selected.attrs.d ?? '')
    : '';

  return (
    <div className="vs-structured">
      <div className="vs-structured-title">{tr('vector.structuredEditor')}</div>
      <p className="vs-muted">{tr('vector.structuredHint')}</p>
      <div className="vs-structured-tree" role="list" aria-label={tr('vector.structuredTree')}>
        {entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="listitem"
            className={'vs-structured-node' + (selectedId === entry.id ? ' vs-selected' : '') + (entry.editable ? '' : ' vs-structured-opaque')}
            style={{ paddingLeft: 8 + entry.depth * 12 }}
            disabled={disabled}
            onClick={() => setSelectedId(entry.id)}
            title={entry.label}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {selected?.kind === 'opaque' ? (
        <div className="vs-structured-opaque-panel">
          <p className="vs-muted">{tr('vector.structuredOpaque')}</p>
          <pre className="vs-structured-markup" aria-label={tr('vector.structuredOpaqueMarkup')}>
            {selected.markup.length > 280 ? `${selected.markup.slice(0, 280)}…` : selected.markup}
          </pre>
        </div>
      ) : null}
      {selected?.kind === 'editable' ? (
        <div className="vs-structured-fields">
          <div className="vs-structured-tag">{selected.tag}</div>
          {selected.tag === 'path' ? (
            <label>
              {tr('vector.structuredPathD')}
              <textarea
                aria-label={tr('vector.structuredPathD')}
                spellCheck={false}
                disabled={disabled}
                value={pathD}
                rows={3}
                onChange={(event) => onPathD(event.target.value)}
              />
            </label>
          ) : null}
          <div className="vs-fields">
            {attrNames.map((name) => (
              <label key={name}>
                {name}
                <input
                  aria-label={`${selected.tag} ${name}`}
                  disabled={disabled}
                  value={selected.attrs[name] ?? ''}
                  onChange={(event) => onAttr(name, event.target.value)}
                />
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

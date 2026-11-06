/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StructuredSvgControls from './StructuredSvgControls';

afterEach(() => cleanup());

const tr = (key: string) => key;

const SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
  <defs><linearGradient id="paint"><stop offset="0"/></linearGradient></defs>
  <rect id="plate" x="2" y="3" width="8" height="9" fill="#abc"/>
</svg>`;

describe('StructuredSvgControls', () => {
  it('edits an editable attr and does not rewrite opaque markup in the callback svg', () => {
    const onSvgChange = vi.fn();
    render(<StructuredSvgControls svg={SAMPLE} tr={tr} onSvgChange={onSvgChange} />);

    expect(screen.getByLabelText('vector.structuredTree')).toBeTruthy();
    fireEvent.click(screen.getByTitle('rect#plate'));
    const width = screen.getByLabelText('rect width') as HTMLInputElement;
    fireEvent.change(width, { target: { value: '22' } });

    expect(onSvgChange).toHaveBeenCalled();
    const next = onSvgChange.mock.calls.at(-1)?.[0] as string;
    expect(next).toMatch(/width="22"/);
    expect(next).toMatch(/<linearGradient\b/);
    expect(next).toMatch(/<defs\b/);
  });

  it('shows opaque nodes as non-editable readouts', () => {
    render(<StructuredSvgControls svg={SAMPLE} tr={tr} onSvgChange={() => {}} />);
    fireEvent.click(screen.getByTitle(/opaque · defs/i));
    expect(screen.getByText('vector.structuredOpaque')).toBeTruthy();
    expect(screen.getByLabelText('vector.structuredOpaqueMarkup').textContent).toMatch(/linearGradient/);
  });
});

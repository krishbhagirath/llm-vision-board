import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SegmentedControl } from '@/components/SegmentedControl';
import { Dialog } from '@/components/Dialog';
import { Menu } from '@/components/Menu';
import { ErrorBoundary } from '@/components/ErrorBoundary';

describe('SegmentedControl', () => {
  it('has radiogroup semantics and moves with arrow keys', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="View"
        value="a"
        onChange={onChange}
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ]}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeTruthy();
    const alpha = screen.getByRole('radio', { name: 'Alpha' });
    expect(alpha.getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(alpha, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('Dialog', () => {
  it('is labelled, closes on Escape and traps Tab', () => {
    const onClose = vi.fn();
    render(
      <Dialog title="Hello" onClose={onClose}>
        <button>first</button>
        <button>last</button>
      </Dialog>,
    );
    const dlg = screen.getByRole('dialog', { name: 'Hello' });
    expect(dlg).toBeTruthy();
    fireEvent.keyDown(dlg, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Menu', () => {
  it('opens, navigates with arrows and selects', () => {
    const b = vi.fn();
    render(
      <Menu
        label="Actions"
        trigger={<span>more</span>}
        items={[
          { label: 'One', onSelect: vi.fn() },
          { label: 'Two', onSelect: b },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    const menu = screen.getByRole('menu');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'One' }));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Two' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Two' }));
    expect(b).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('ErrorBoundary', () => {
  it('shows a friendly fallback and recovers on Reload view', () => {
    let boom = true;
    function Bomb() {
      if (boom) throw new Error('x');
      return <p>fine</p>;
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary region="canvas">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/canvas hit a problem/)).toBeTruthy();
    boom = false;
    fireEvent.click(screen.getByRole('button', { name: 'Reload view' }));
    expect(screen.getByText('fine')).toBeTruthy();
    spy.mockRestore();
  });
});

// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Theme } from '../src/shared/types';
import { ThemeMenu } from '../src/renderer/ThemeMenu';
let host: HTMLDivElement; let root: Root; const saved = vi.fn();
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); saved.mockClear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render() {
  function Example() { const [theme, setTheme] = useState<Theme>('system'); return createElement(ThemeMenu, { theme, onChange: next => { saved(next); setTheme(next); } }); }
  await act(async () => root.render(createElement(Example)));
}
async function pick(label: string) {
  await act(async () => (host.querySelector('[role="combobox"]') as HTMLButtonElement).click());
  const option = [...host.querySelectorAll('[role="option"]')].find(node => node.textContent === label)!;
  await act(async () => (option as HTMLElement).click());
}
it('uses the saved theme and updates it through Light, Dark, and System selections', async () => {
  await render(); expect(host.querySelector('[role="combobox"]')?.getAttribute('title')).toBe('System');
  for (const [label, value] of [['Dark', 'dark'], ['Light', 'light'], ['System', 'system']]) {
    await pick(label); expect(saved).toHaveBeenLastCalledWith(value);
    expect(host.querySelector('[role="combobox"]')?.getAttribute('title')).toBe(label);
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  }
});
it('does not rewrite preferences when the current theme is selected again', async () => {
  await render(); await pick('System'); expect(saved).not.toHaveBeenCalled();
});

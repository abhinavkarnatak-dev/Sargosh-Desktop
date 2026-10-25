// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ThemedSelect } from '../src/renderer/ThemedSelect';
import { STT_LANGUAGES } from '../src/shared/transcription';
let root: Root; let host: HTMLDivElement; const changed = vi.fn();
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); changed.mockClear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(disabled = false) {
  function Example() { const [value, setValue] = useState('en'); return createElement(ThemedSelect, { label: 'Language', value, options: STT_LANGUAGES, disabled, onChange: next => { changed(next); setValue(next); } }); }
  await act(async () => root.render(createElement(Example)));
}
const trigger = () => host.querySelector('[role="combobox"]') as HTMLButtonElement;
async function key(value: string) { await act(async () => trigger().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))); }
it('shows the themed menu and selects the same provider language value', async () => {
  await render(); await act(async () => trigger().click());
  expect(trigger().getAttribute('aria-expanded')).toBe('true');
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(3);
  expect(host.querySelector('[aria-selected="true"]')?.textContent).toBe('English');
  await act(async () => (host.querySelectorAll('[role="option"]')[2] as HTMLElement).click());
  expect(changed).toHaveBeenCalledExactlyOnceWith('multi'); expect(trigger().textContent).toBe('Hinglish');
  expect(host.querySelector('[role="listbox"]')).toBeNull();
});
it('navigates with arrows and selects only on Enter', async () => {
  await render(); await key('ArrowDown'); await key('ArrowDown');
  expect(changed).not.toHaveBeenCalled(); await key('Enter'); expect(changed).toHaveBeenCalledExactlyOnceWith('hi');
});
it('supports Home, End, and type-ahead search', async () => {
  await render(); await key('End'); await key('Enter'); expect(changed).toHaveBeenLastCalledWith('multi');
  await key('Home'); await key('Enter'); expect(changed).toHaveBeenLastCalledWith('en');
  await key('h'); await key('i'); await key('n'); await key('g'); await key('Enter'); expect(changed).toHaveBeenLastCalledWith('multi');
});
it('closes with Escape without bubbling to the Settings dialog', async () => {
  await render(); const parentKey = vi.fn(); document.body.addEventListener('keydown', parentKey);
  await key('Enter'); parentKey.mockClear(); await key('Escape'); document.body.removeEventListener('keydown', parentKey);
  expect(trigger().getAttribute('aria-expanded')).toBe('false'); expect(parentKey).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
});
it('closes on an outside press or Tab without changing selection', async () => {
  await render(); await key('Enter');
  await act(async () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  expect(trigger().getAttribute('aria-expanded')).toBe('false');
  await key('Enter'); await key('Tab'); expect(trigger().getAttribute('aria-expanded')).toBe('false'); expect(changed).not.toHaveBeenCalled();
});
it('does not open when disabled', async () => {
  await render(true); expect(trigger().disabled).toBe(true); await key('ArrowDown'); expect(host.querySelector('[role="listbox"]')).toBeNull();
});

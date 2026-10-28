// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SettingsDialog } from '../src/renderer/SettingsDialog';
import { DEFAULT_PREFERENCES } from '../src/shared/types';
vi.mock('../src/renderer/audio/runtime', () => ({
  useRecording: () => ({ phase: 'idle' }), useTranscription: () => ({ phase: 'idle', language: 'en' }),
  useCleanup: () => ({ phase: 'idle' }), transcription: { configure: vi.fn() }
}));
let root: Root; let host: HTMLDivElement;
const onClose = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); onClose.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  document.documentElement.removeAttribute('style'); document.body.removeAttribute('style'); vi.useRealTimers();vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(createElement(StrictMode, null, createElement(SettingsDialog, {
    preferences: DEFAULT_PREFERENCES,
    onSave: async () => {}, onClose
  }))));
  const dialog = host.querySelector('dialog')!;
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 800, top: 100, bottom: 700 } as DOMRect);
  return dialog;
}
async function gesture(start: Element, end: Element, from = [50, 50], to = from) {
  await act(async () => {
    start.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: from[0], clientY: from[1] }));
    end.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: to[0], clientY: to[1] }));
  });
}
it('locks document scrolling while open and restores existing styles on unmount, including in StrictMode', async () => {
  document.documentElement.style.setProperty('overflow', 'auto', 'important'); document.body.style.overflow = 'scroll';
  const dialog = await render(); expect(dialog.open).toBe(true);
  expect(document.documentElement.style.overflow).toBe('hidden'); expect(document.body.style.overflow).toBe('hidden');
  await act(async () => root.render(null));
  expect(dialog.open).toBe(false);
  expect(document.documentElement.style.overflow).toBe('auto'); expect(document.documentElement.style.getPropertyPriority('overflow')).toBe('important');
  expect(document.body.style.overflow).toBe('scroll');
});
it('closes when a gesture starts and ends on the backdrop', async () => {
  const dialog = await render(); await gesture(dialog, dialog); expect(onClose).not.toHaveBeenCalled();expect(dialog.dataset.closing).toBe('true');expect(document.body.style.overflow).toBe('hidden');await act(async()=>vi.advanceTimersByTime(180)); expect(onClose).toHaveBeenCalledOnce();
});
it('keeps Settings open for content clicks and dialog border clicks', async () => {
  const dialog = await render(); const content = host.querySelector('.settings-content')!;
  await gesture(content, content, [200, 200]); await gesture(dialog, dialog, [100, 200]);
  expect(onClose).not.toHaveBeenCalled();
});
it('does not dismiss a drag that starts inside Settings and ends outside', async () => {
  const dialog = await render(); await gesture(host.querySelector('.settings-content')!, dialog, [200, 200], [50, 50]);
  expect(onClose).not.toHaveBeenCalled();
});
it('keeps Escape and the close button working without duplicate dismissal', async () => {
  const dialog = await render();
  await act(async () => dialog.dispatchEvent(new Event('cancel', { cancelable: true })));
  await act(async () => (host.querySelector('[aria-label="Close settings"]') as HTMLButtonElement).click());
  expect(onClose).not.toHaveBeenCalled();await act(async()=>vi.advanceTimersByTime(180));expect(onClose).toHaveBeenCalledOnce();
});

it('orders themes System, Dark, Light and shows the release version',async()=>{
 await render();expect(Array.from(host.querySelectorAll('.theme-picker button')).map(button=>button.textContent)).toEqual(['System','Dark','Light']);expect(host.querySelector('.settings-version')?.textContent).toBe('Sargosh 1.0.1');
});

it('closes immediately when reduced motion is preferred',async()=>{
 const media=vi.spyOn(window,'matchMedia').mockImplementation(query=>({matches:query==='(prefers-reduced-motion: reduce)',addEventListener(){},removeEventListener(){}} as unknown as MediaQueryList));
 try{await render();await act(async()=>(host.querySelector('[aria-label="Close settings"]') as HTMLButtonElement).click());expect(onClose).toHaveBeenCalledOnce();}finally{media.mockRestore();}
});
it('cancels a pending exit callback when the modal is removed',async()=>{
 await render();await act(async()=>(host.querySelector('[aria-label="Close settings"]') as HTMLButtonElement).click());await act(async()=>root.render(null));await act(async()=>vi.advanceTimersByTime(180));expect(onClose).not.toHaveBeenCalled();
});

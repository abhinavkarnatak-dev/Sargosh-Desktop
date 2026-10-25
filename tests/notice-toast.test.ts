// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NoticeToast } from '../src/renderer/NoticeToast';
let root: Root; let host: HTMLDivElement;
const dismiss = vi.fn();
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); dismiss.mockClear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render(message = 'Transcript copied.', id = 1) { await act(async () => root.render(createElement(NoticeToast, { key: id, message, onDismiss: dismiss }))); }
it.each(['Transcript copied.', 'Transcript and recording deleted.', 'Original audio saved.'])('shows %s without a close button and expires after exactly two seconds', async message => {
  await render(message); expect(host.querySelector('.success-toast')?.textContent).toContain(message); expect(host.querySelector('button')).toBeNull();
  await act(async () => vi.advanceTimersByTime(1999)); expect(dismiss).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(1)); expect(dismiss).toHaveBeenCalledOnce();
});
it('gives a repeated copy a fresh two seconds and cancels the previous timer', async () => {
  await render(); await act(async () => vi.advanceTimersByTime(1500)); await render('Transcript copied.', 2);
  await act(async () => vi.advanceTimersByTime(500)); expect(dismiss).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(1500)); expect(dismiss).toHaveBeenCalledOnce();
});
it('preserves a dismiss button and longer display time for other notices', async () => {
  await render('Your preference could not be saved.'); expect(host.querySelector('.success-toast')).toBeNull();
  await act(async () => vi.advanceTimersByTime(2000)); expect(dismiss).not.toHaveBeenCalled();
  await act(async () => (host.querySelector('button') as HTMLElement).click()); expect(dismiss).toHaveBeenCalledOnce();
});

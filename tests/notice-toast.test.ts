// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, Fragment, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NoticeToast } from '../src/renderer/NoticeToast';
import { useModalDialog } from '../src/renderer/modal';
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
it('keeps an existing toast above nested modals and preserves its original expiry as they open and close', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'showPopover');
  const show = vi.fn(function(this: HTMLElement) { expect(this.isConnected).toBe(true); });
  Object.defineProperty(HTMLElement.prototype, 'showPopover', { configurable: true, value: show });
  function Modal({ name }: { name: string }) {
    const ref = useRef<HTMLDialogElement>(null); useModalDialog(ref);
    return createElement('dialog', { ref, 'data-modal': name }, createElement('input', { 'aria-label': name }));
  }
  function Harness({ settings, confirm }: { settings: boolean; confirm: boolean }) {
    return createElement(Fragment, null,
      createElement(NoticeToast, { message: 'Your preference could not be saved.', onDismiss: dismiss }),
      settings && createElement(Modal, { name: 'settings' }), confirm && createElement(Modal, { name: 'delete' }));
  }
  const update = async (settings: boolean, confirm: boolean) => { await act(async () => root.render(createElement(Harness, { settings, confirm }))); };
  const toast = () => document.querySelector<HTMLElement>('.toast')!;
  try {
    await update(false, false); await act(async () => vi.advanceTimersByTime(1000));
    await update(true, false);
    expect(toast().parentElement?.dataset.modal).toBe('settings');
    expect(toast().getAttribute('popover')).toBe('manual');
    await act(async () => vi.advanceTimersByTime(1000));
    await update(true, true);
    expect(toast().parentElement?.dataset.modal).toBe('delete');
    expect(show).toHaveBeenLastCalledWith();
    const input = document.querySelector<HTMLInputElement>('[aria-label=delete]')!;
    input.focus();
    expect(document.activeElement).toBe(input);
    await act(async () => vi.advanceTimersByTime(1000));
    await update(true, false); expect(toast().parentElement?.dataset.modal).toBe('settings');
    await act(async () => vi.advanceTimersByTime(1000));
    await update(false, false); expect(toast().closest('dialog')).toBeNull();
    await act(async () => vi.advanceTimersByTime(2999)); expect(dismiss).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1)); expect(dismiss).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledTimes(5);
  } finally {
    await act(async () => root.render(null));
    if (descriptor) Object.defineProperty(HTMLElement.prototype, 'showPopover', descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, 'showPopover');
  }
});

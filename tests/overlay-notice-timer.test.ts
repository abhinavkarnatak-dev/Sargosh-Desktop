// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { NoticeCard } from '../src/renderer/Overlay';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('dismisses after five seconds without resetting on a same-notice rerender and disables the X tooltip', async () => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'), root = createRoot(host), onDismiss = vi.fn();
  const notice = { id: 'cancelled', kind: 'info' as const, title: 'Recording cancelled', message: 'Discarded.' };
  try {
    await act(async () => root.render(createElement(NoticeCard, { notice, onDismiss })));
    expect(host.querySelector('button')?.getAttribute('data-tooltip')).toBe('');
    expect(host.querySelector('.overlay-notice-countdown circle')).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(3000));
    await act(async () => root.render(createElement(NoticeCard, { notice: { ...notice }, onDismiss: () => onDismiss() })));
    await act(async () => vi.advanceTimersByTime(1999));
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(host.querySelector('.overlay-notice')?.getAttribute('data-closing')).toBe('true');
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(180));
    expect(onDismiss).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); }
});

it.each(['bottom', 'left', 'right'])('lets the %s dock finish its exit on X without duplicate dismissal', async dock => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'), root = createRoot(host), onDismiss = vi.fn();
  try {
    await act(async () => root.render(createElement('div', { className: 'overlay-stage', 'data-dock': dock },
      createElement(NoticeCard, { notice: { id: dock, kind: 'info', title: 'Cancelled', message: '' }, onDismiss }))));
    await act(async () => { (host.querySelector('button') as HTMLButtonElement).click(); (host.querySelector('button') as HTMLButtonElement).click(); });
    expect(host.querySelector('.overlay-notice')?.getAttribute('data-closing')).toBe('true');
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(180)); expect(onDismiss).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTime(5000)); expect(onDismiss).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); }
});

it('clears the expiry timer when a notice closes early', async () => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(document.createElement('div')), onDismiss = vi.fn();
  await act(async () => root.render(createElement(NoticeCard, { notice: { id: 'error', kind: 'error', title: 'Unavailable', message: '' }, onDismiss })));
  await act(async () => root.unmount());
  await act(async () => vi.advanceTimersByTime(5000));
  expect(onDismiss).not.toHaveBeenCalled();
});

it('dismisses immediately when reduced motion is preferred', async () => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(document.createElement('div')), onDismiss = vi.fn();
  const reduced = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
  try {
    await act(async () => root.render(createElement(NoticeCard, { notice: { id: 'reduced', kind: 'info', title: 'Cancelled', message: '' }, onDismiss })));
    await act(async () => vi.advanceTimersByTime(5000)); expect(onDismiss).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); reduced.mockRestore(); }
});

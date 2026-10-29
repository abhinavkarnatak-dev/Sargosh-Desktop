// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { overlayCornerRadius, useOverlayHitRegions } from '../src/renderer/overlay-hit';
import { validOverlayRegions } from '../src/shared/overlay-hit';

afterEach(() => { delete window.sargosh; vi.unstubAllGlobals(); });
it('reports visible rounded controls and follows dock, expansion and notice changes without capturing tooltips', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let next = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++next, callback); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const send = vi.fn().mockResolvedValue(undefined);
  window.sargosh = { overlayHitRegions: send } as unknown as NonNullable<typeof window.sargosh>;
  function Probe() { useOverlayHitRegions(); return null; }
  const host = document.createElement('div'); document.body.append(host);
  host.innerHTML = '<div class="overlay-pill" style="border-radius:50%"></div><section class="overlay-notice" style="border-radius:16px"></section><span class="overlay-tooltip">Hint</span>';
  const pill = host.querySelector<HTMLElement>('.overlay-pill')!;
  const notice = host.querySelector<HTMLElement>('.overlay-notice')!;
  let pillBox = { x: 6, y: 60, width: 38, height: 38 };
  pill.getBoundingClientRect = () => pillBox as DOMRect;
  notice.getBoundingClientRect = () => ({ x: 64, y: 10, width: 320, height: 140 }) as DOMRect;
  const mount = document.createElement('div'); host.append(mount);
  const root = createRoot(mount);
  const frame = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(performance.now())); };
  try {
    await act(async () => root.render(createElement(Probe)));
    frame();
    expect(send).toHaveBeenLastCalledWith([{ ...pillBox, radius: 19 }, { x: 64, y: 10, width: 320, height: 140, radius: 16 }]);
    const count = send.mock.calls.length;
    frame(); expect(send).toHaveBeenCalledTimes(count);
    // Chromium reports mixed length/percentage values mid-transition.
    const computed = getComputedStyle;
    vi.stubGlobal('getComputedStyle', (node: Element) => node === pill ? { visibility: 'visible', display: 'flex', pointerEvents: 'auto', borderTopLeftRadius: 'calc(25% + 11px)' } : computed(node));
    frame();
    expect(send.mock.calls.every(([regions]) => validOverlayRegions(regions))).toBe(true);
    expect(send.mock.calls.at(-1)?.[0][0].radius).toBe(19);
    pillBox = { x: 450, y: 30, width: 38, height: 152 };
    pill.classList.add('expanded');
    pill.dispatchEvent(new Event('transitionrun', { bubbles: true }));
    frame();
    expect(send).toHaveBeenLastCalledWith([{ ...pillBox, radius: 19 }, { x: 64, y: 10, width: 320, height: 140, radius: 16 }]);
    notice.style.visibility = 'hidden';
    window.dispatchEvent(new Event('resize')); frame();
    expect(send).toHaveBeenLastCalledWith([{ ...pillBox, radius: 19 }]);
  } finally {
    await act(async () => root.unmount());
    expect(send).toHaveBeenLastCalledWith([]);
    expect(frames.size).toBe(0);
    host.remove();
  }
});
it.each([
 ['50%',38,38,19],['22px',118,38,19],['calc(25% + 11px)',38,38,19],
 ['calc(10% + 5px)',100,40,9],['calc(22px - 10%)',100,40,18],
 ['9999px',38,38,19],['-2px',38,38,0],['unexpected',38,38,0],['22px',NaN,38,0]
] as const)('keeps the animated corner %s finite and within the visible box', (value,width,height,expected) => {
 expect(overlayCornerRadius(value,width,height)).toBe(expected);
});

// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { RollingNumber } from '../src/renderer/RollingNumber';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('starts at the saved value and rolls subsequent updates from the previous value', async () => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); const root = createRoot(host);
  const render = async (value: number) => { await act(async () => root.render(createElement(RollingNumber, { value }))); };
  const tracks = () => Array.from(host.querySelectorAll('.rolling-digit-track')).map(track => track.textContent);
  try {
    await render(11); expect(tracks()).toEqual(['1', '1']);
    await render(14); expect(tracks()).toEqual(['1', '1234']);
    // An update during a roll does not interrupt it or restart at zero.
    await render(19); expect(tracks()).toEqual(['1', '1234']);
    await act(async () => { vi.advanceTimersByTime(480); });
    expect(tracks()).toEqual(['1', '456789']);
    await act(async () => { vi.advanceTimersByTime(480); });
    expect(tracks()).toEqual(['1', '9']);
    expect(host.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('19');
  } finally { await act(async () => root.unmount()); }
});
it('handles digit carry, formatted thousands, and decreasing values', async () => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); const root = createRoot(host);
  const render = async (value: number) => { await act(async () => root.render(createElement(RollingNumber, { value }))); };
  try {
    await render(999); await render(1000);
    expect(Array.from(host.querySelectorAll('.rolling-digit-track')).map(track => track.textContent)).toEqual(['01', '90', '90', '90']);
    expect(host.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe((1000).toLocaleString());
    await act(async () => { vi.advanceTimersByTime(480); });
    await render(998);
    expect(Array.from(host.querySelectorAll('.rolling-digit-track')).map(track => track.textContent)).toEqual(['90', '90', '890']);
    await act(async () => { vi.advanceTimersByTime(480); });
    expect(host.textContent).toBe('998');
  } finally { await act(async () => root.unmount()); }
});

it('compacts word totals while keeping the exact accessible count and rolling from the current decimal digit',async()=>{
  vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  const host=document.createElement('div'),root=createRoot(host);
  const render=async(value:number)=>{await act(async()=>root.render(createElement(RollingNumber,{value,compact:true})));};
  const visual=()=>host.querySelector('.rolling-number-visual')?.textContent;
  try{
    await render(999);expect(visual()).toBe('999');
    await render(1000);await act(async()=>vi.advanceTimersByTime(480));expect(visual()).toBe('1K');
    await render(1100);expect([...host.querySelectorAll('.rolling-digit-track')].map(node=>node.textContent)).toEqual(['1','01']);
    await act(async()=>vi.advanceTimersByTime(480));expect(visual()).toBe('1.1K');
    await render(1266);await act(async()=>vi.advanceTimersByTime(480));expect(visual()).toBe('1.2K');
    expect(host.querySelector('[role=img]')?.getAttribute('aria-label')).toBe((1266).toLocaleString());
    await render(1356);await act(async()=>vi.advanceTimersByTime(480));expect(visual()).toBe('1.3K');
    await render(1999);await act(async()=>vi.advanceTimersByTime(480));expect(visual()).toBe('1.9K');
    await render(12500);await act(async()=>vi.advanceTimersByTime(480));expect(visual()).toBe('12.5K');
  }finally{await act(async()=>root.unmount());}
});

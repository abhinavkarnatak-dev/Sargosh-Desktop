// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { StoreUpdatePreview } from '../src/renderer/dev/StoreUpdatePreview';
let root:Root,host:HTMLDivElement;
const forbidden=vi.fn(()=>{throw new Error('Preview must never call a real service or restart.');});
beforeEach(()=>{
  vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);forbidden.mockClear();
  vi.stubGlobal('fetch',forbidden);
  window.sargosh={storeUpdateAction:forbidden,storeUpdateState:forbidden,startWindowsRecording:forbidden} as unknown as typeof window.sargosh;
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete window.sargosh;vi.useRealTimers();vi.unstubAllGlobals();});
const button=(label:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.getAttribute('aria-label')===label||node.textContent===label)!;
const click=async(label:string)=>{await act(async()=>button(label).click());};
const advance=async(ms:number)=>{await act(async()=>vi.advanceTimersByTime(ms));};
it('previews Later, download progress and restart completion without invoking the native bridge or network',async()=>{
  await act(async()=>root.render(createElement(StoreUpdatePreview)));
  await click('Show update popup');expect(host.querySelector('dialog')?.open).toBe(true);
  await click('Later');await advance(180);expect(host.querySelector('dialog')).toBeNull();expect(button('Update available')).toBeDefined();
  await click('Update available');await advance(700);expect(host.querySelector('progress')?.value).toBeGreaterThan(0);
  await advance(6000);expect(button('Restart to update')).toBeDefined();
  await click('Restart to update');expect(button('Updating Sargosh…').disabled).toBe(true);
  await advance(1800);expect(host.textContent).toContain('Restart simulation complete');expect(button('Check for updates')).toBeDefined();
  expect(forbidden).not.toHaveBeenCalled();
});
it('supports both themes and a collapsed sidebar without changing saved preferences',async()=>{
  await act(async()=>root.render(createElement(StoreUpdatePreview)));expect(document.documentElement.dataset.theme).toBe('dark');
  await click('Light');expect(document.documentElement.dataset.theme).toBe('light');
  await click('Collapse sidebar');expect(host.querySelector('.app-shell')?.classList.contains('collapsed')).toBe(true);
  expect(button('Update available').dataset.tooltip).toBe('Update available');
  await click('Dark');expect(document.documentElement.dataset.theme).toBe('dark');expect(forbidden).not.toHaveBeenCalled();
});
it('defers the popup during simulated dictation and cancels preview timers on reset',async()=>{
  await act(async()=>root.render(createElement(StoreUpdatePreview)));
  await act(async()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  await click('Show update popup');expect(host.querySelector('dialog')).toBeNull();expect(button('Update available').disabled).toBe(true);
  await act(async()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());expect(host.querySelector('dialog')?.open).toBe(true);
  await click('Update now');await advance(180);await click('Simulate download error');expect(button('Update available')).toBeDefined();
  await click('Update available');await advance(350);await click('Reset preview');await advance(10000);
  expect(button('Restart to update')).toBeUndefined();expect(button('Update available')).toBeDefined();expect(forbidden).not.toHaveBeenCalled();
});

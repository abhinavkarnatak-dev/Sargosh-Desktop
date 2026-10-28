// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { StoreUpdateView } from '../src/renderer/StoreUpdateControl';
import { NO_STORE_UPDATES, type StoreUpdateState } from '../src/shared/store-update';
let host:HTMLDivElement,root:Root;const action=vi.fn();
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);action.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();});
async function render(update:Partial<StoreUpdateState>,collapsed=false,allowPrompt=true){await act(async()=>root.render(createElement(StoreUpdateView,{state:{...NO_STORE_UPDATES,phase:'available',...update},collapsed,allowPrompt,onAction:action})));}
function button(name:string){return [...host.querySelectorAll('button')].find(node=>node.getAttribute('aria-label')===name||node.textContent===name)!;}
it('keeps a persistent sidebar action after the popup is deferred',async()=>{
  await render({prompt:true});expect(host.querySelector('dialog')?.open).toBe(true);
  await act(async()=>{button('Later').click();});expect(action).not.toHaveBeenCalled();
  await act(async()=>vi.advanceTimersByTime(180));expect(action).toHaveBeenCalledWith('later');
  await render({prompt:false});expect(host.querySelector('dialog')).toBeNull();
  await act(async()=>button('Update available').click());expect(action).toHaveBeenLastCalledWith('download');
});
it('starts the download through the in-app Update now control after its exit transition',async()=>{
  await render({prompt:true});await act(async()=>button('Update now').click());await act(async()=>vi.advanceTimersByTime(180));expect(action).toHaveBeenCalledWith('download');
});
it('shows a non-clickable download progress state, then the restart action only when ready',async()=>{
  await render({phase:'downloading',progress:.43});expect((button('Downloading 43%') as HTMLButtonElement).disabled).toBe(true);expect(host.querySelector('progress')?.value).toBe(.43);expect(button('Restart to update')).toBeUndefined();
  await render({phase:'ready',progress:1});await act(async()=>button('Restart to update').click());expect(action).toHaveBeenCalledWith('install');
});
it('does not show a popup or allow installation during protected work, settings or onboarding',async()=>{
  await render({prompt:true,blocked:true});expect(host.querySelector('dialog')).toBeNull();
  await render({phase:'ready',blocked:true});expect((button('Restart to update') as HTMLButtonElement).disabled).toBe(true);
  await render({prompt:true},false,false);expect(host.querySelector('dialog')).toBeNull();
});
it('keeps collapsed sidebar controls labelled for accessibility and custom tooltips',async()=>{
  await render({phase:'ready',progress:1},true);const target=button('Restart to update');expect(target.dataset.tooltip).toBe('Restart to update');expect(host.querySelector('.store-update-dot')).not.toBeNull();
  await render({phase:'ready',progress:1},false);expect(button('Restart to update').dataset.tooltip).toBe('');
});

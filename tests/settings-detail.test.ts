// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect,it,vi } from 'vitest';
import { SettingsDetail } from '../src/renderer/SettingsDetail';
it('disables closing content immediately, retains it for the exit, and handles reopening',async()=>{
 vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const render=async(open:boolean)=>{await act(async()=>root.render(createElement(SettingsDetail,{id:'detail',open,children:createElement('button',null,'Content')})));};
 try{
 await render(false);expect(host.querySelector('button')).toBeNull();await render(true);expect(host.querySelector('button')).not.toBeNull();
 await render(false);expect(host.querySelector('#detail')?.hasAttribute('inert')).toBe(true);expect(host.querySelector('button')).not.toBeNull();
 await act(async()=>vi.advanceTimersByTime(100));await render(true);await act(async()=>vi.advanceTimersByTime(220));expect(host.querySelector('button')).not.toBeNull();
 await render(false);await act(async()=>vi.advanceTimersByTime(220));expect(host.querySelector('button')).toBeNull();
 }finally{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();}
});

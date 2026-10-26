// @vitest-environment happy-dom
import { act,createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect,it,vi } from 'vitest';
import { DictationGuide } from '../src/renderer/DictationGuide';
import { DEFAULT_PREFERENCES } from '../src/shared/types';
import { INITIAL_WINDOWS_STATE,type WindowsState } from '../src/shared/windows';
it('automatically activates shortcuts after setup and offers resume if they become paused',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);let state={...INITIAL_WINDOWS_STATE};let listener!:(state:WindowsState)=>void;
 const arm=vi.fn(async(shortcut:string)=>{state={...state,enabled:true,purpose:'recording',shortcut};listener(state);return state;});
 window.sargosh={windowsStatus:async()=>state,startWindowsRecording:arm,onWindowsState:(value:typeof listener)=>{listener=value;return()=>{};}} as unknown as NonNullable<typeof window.sargosh>;
 const host=document.createElement('div');const root=createRoot(host);
 try{
  await act(async()=>root.render(createElement(DictationGuide,{preferences:DEFAULT_PREFERENCES,enabled:false})));expect(arm).not.toHaveBeenCalled();
  await act(async()=>root.render(createElement(DictationGuide,{preferences:DEFAULT_PREFERENCES,enabled:true})));expect(arm).toHaveBeenCalledOnce();expect(host.textContent).not.toContain('Enable recording shortcuts');
  await act(async()=>{state={...state,enabled:false};listener(state);});expect(host.textContent).toContain('Recording shortcuts are paused');
  await act(async()=>host.querySelector('button')!.click());expect(arm).toHaveBeenCalledTimes(2);expect(host.textContent).not.toContain('Recording shortcuts are paused');
 }finally{await act(async()=>root.unmount());delete window.sargosh;vi.unstubAllGlobals();}
});

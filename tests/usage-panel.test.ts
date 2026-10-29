// @vitest-environment happy-dom
import { it,expect,vi } from 'vitest';
import { act,createElement } from 'react';import { createRoot } from 'react-dom/client';
import { UsagePanel } from '../src/renderer/UsagePanel';
it('shows remaining time and accessible progress without rounding a partial minute up',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 window.sargosh={usage:async()=>({enabled:true,dailyLimitSeconds:600,monthlyLimitSeconds:6000,dailyUsedSeconds:90,monthlyUsedSeconds:120,dailyResetAt:'2026-10-27T00:00:00Z',monthlyResetAt:'2026-11-01T00:00:00Z'})} as unknown as NonNullable<typeof window.sargosh>;
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{await act(async()=>root.render(createElement(UsagePanel)));expect(host.textContent).toContain('8m 30s remaining');expect(host.querySelectorAll('progress')).toHaveLength(2);expect(host.textContent).toContain('98m 0s remaining');}
 finally{await act(async()=>root.unmount());host.remove();delete window.sargosh;vi.unstubAllGlobals();}
});

it.each(['local','browser','failed'] as const)('explains unavailable usage instead of rendering a blank %s page',async(mode)=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 if(mode!=='browser')window.sargosh={usage:mode==='failed'?vi.fn().mockRejectedValue(new Error('Offline')):async()=>null} as unknown as NonNullable<typeof window.sargosh>;
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
 await act(async()=>root.render(createElement(UsagePanel)));
 expect(host.querySelector('section')).not.toBeNull();expect(host.querySelectorAll('progress')).toHaveLength(0);
 expect(host.textContent).toContain(mode==='local'?'Usage is not tracked by the local development server.':mode==='browser'?'Open the Sargosh desktop app':'Could not load your allowance.');
 if(mode==='failed'){
 window.sargosh!.usage=async()=>({enabled:true,dailyLimitSeconds:600,monthlyLimitSeconds:6000,dailyUsedSeconds:0,monthlyUsedSeconds:0,dailyResetAt:'2026-10-30T00:00:00Z',monthlyResetAt:'2026-11-01T00:00:00Z'});
 await act(async()=>(host.querySelector('button') as HTMLButtonElement).click());expect(host.querySelectorAll('progress')).toHaveLength(2);expect(host.textContent).not.toContain('Could not load');
 }
 }finally{await act(async()=>root.unmount());host.remove();delete window.sargosh;vi.unstubAllGlobals();}
});

it.each([60,0])('shows an inline allowance alert with the appropriate symbol at %s seconds',async seconds=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 window.sargosh={usage:async()=>({enabled:true,dailyLimitSeconds:600,monthlyLimitSeconds:6000,dailyUsedSeconds:600-seconds,monthlyUsedSeconds:0,dailyResetAt:'2026-10-30T00:00:00Z',monthlyResetAt:'2026-11-01T00:00:00Z'})} as unknown as NonNullable<typeof window.sargosh>;
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(createElement(UsagePanel)));
  const alert=host.querySelector('.allowance-alert');
  expect(alert?.querySelector('svg')).not.toBeNull();
  expect(alert?.classList.contains('allowance-alert-reached')).toBe(seconds===0);
  expect(alert?.textContent).toContain(seconds===0?'reached your daily allowance':'1 minute or less');
  expect(host.querySelector('.allowance-alerts')?.nextElementSibling?.className).toBe('usage-grid');
  expect(host.querySelector('.toast')).toBeNull();
 }finally{await act(async()=>root.unmount());host.remove();delete window.sargosh;vi.unstubAllGlobals();}
});

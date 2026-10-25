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

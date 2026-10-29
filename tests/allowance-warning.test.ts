// @vitest-environment happy-dom
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { act,createElement,Fragment } from 'react';
import { UsagePanel } from '../src/renderer/UsagePanel';
import { createRoot,type Root } from 'react-dom/client';
import { allowanceAlerts,type AccountUsage } from '../src/shared/usage';
import { AllowanceWarning } from '../src/renderer/AllowanceWarning';
const runtime=vi.hoisted(()=>({busy:false}));
vi.mock('../src/renderer/audio/runtime',()=>({
 useRecording:()=>({phase:runtime.busy?'recording':'idle'}),useTranscription:()=>({phase:'idle'}),useDelivery:()=>({phase:'idle'}),cloudBusy:()=>runtime.busy
}));
const usage=(seconds=61):AccountUsage=>({enabled:true,dailyLimitSeconds:600,monthlyLimitSeconds:6000,dailyUsedSeconds:600-seconds,monthlyUsedSeconds:0,dailyResetAt:'2026-10-30T00:00:00Z',monthlyResetAt:'2026-11-01T00:00:00Z'});
let root:Root,host:HTMLDivElement,refresh:()=>void;
const report=vi.fn().mockResolvedValue(undefined);
beforeEach(()=>{
 vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);runtime.busy=false;sessionStorage.clear();report.mockClear();
 window.sargosh={usage:vi.fn().mockResolvedValue(usage()),reportAllowanceWarning:report,onHistoryChanged:(listener:()=>void)=>{refresh=listener;return()=>{};}} as unknown as NonNullable<typeof window.sargosh>;
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete window.sargosh;sessionStorage.clear();vi.useRealTimers();vi.unstubAllGlobals();});
async function render(accountId='account-a',enabled=true){await act(async()=>root.render(createElement(AllowanceWarning,{key:accountId,accountId,enabled})));}
it.each([61,60.01,60,59,1,.5,0,-10])('handles exactly %s seconds remaining without early warnings',seconds=>{
 const alerts=allowanceAlerts(usage(seconds));
 expect(alerts.length).toBe(seconds<=60?1:0);
 if(alerts.length)expect(alerts[0].reached).toBe(seconds<1);
});
it('covers monthly and simultaneous limits while respecting disabled accounting',()=>{
 const value={...usage(60),monthlyUsedSeconds:5940};
 expect(allowanceAlerts(value).map(alert=>alert.message)).toEqual(['You have 1 minute or less left in your daily allowance.','You have 1 minute or less left in your monthly allowance.']);
 expect(allowanceAlerts({...value,enabled:false})).toEqual([]);
});
it('warns once per threshold and reset, then gives a separate reached notice',async()=>{
 const get=vi.mocked(window.sargosh!.usage!);await render();expect(host.querySelector('.toast')).toBeNull();
 get.mockResolvedValue(usage(60));await act(async()=>refresh());
 expect(report.mock.calls.filter(([notice])=>notice!==null).at(-1)?.[0].message).toContain('1 minute or less left in your daily allowance');
 expect(report.mock.calls.filter(([notice])=>notice!==null)).toHaveLength(1);
 expect(host.childElementCount).toBe(0);
 await act(async()=>vi.advanceTimersByTime(7000));expect(host.querySelector('.toast')).toBeNull();
 get.mockResolvedValue(usage(20));await act(async()=>refresh());expect(host.querySelector('.toast')).toBeNull();
 get.mockResolvedValue(usage(0));await act(async()=>refresh());expect(report.mock.calls.filter(([notice])=>notice!==null).at(-1)?.[0].message).toContain('reached your daily allowance');
 await act(async()=>vi.advanceTimersByTime(7000));
 get.mockResolvedValue({...usage(50),dailyResetAt:'2026-10-31T00:00:00Z'});await act(async()=>refresh());
 expect(report.mock.calls.filter(([notice])=>notice!==null).at(-1)?.[0].message).toContain('1 minute or less');
});
it('waits until idle, skips practice setup, and keeps warning state separate for each account',async()=>{
 const get=vi.mocked(window.sargosh!.usage!);get.mockResolvedValue(usage(30));
 await render('account-a',false);expect(get).not.toHaveBeenCalled();
 runtime.busy=true;await render();expect(get).not.toHaveBeenCalled();
 runtime.busy=false;await render();expect(get).toHaveBeenCalledOnce();
 expect(report.mock.calls.filter(([notice])=>notice!==null).at(-1)?.[0].message).toContain('daily allowance');
 await act(async()=>root.render(null));await render();expect(host.querySelector('.toast')).toBeNull();
 await render('account-b');expect(report.mock.calls.filter(([notice])=>notice!==null).at(-1)?.[0].message).toContain('daily allowance');
});
it('keeps usage failures nonblocking and retries on the next refresh',async()=>{
 const get=vi.mocked(window.sargosh!.usage!);get.mockRejectedValueOnce(new Error('Offline'));await render();
 expect(host.querySelector('.toast')).toBeNull();get.mockResolvedValue(usage(30));await act(async()=>refresh());expect(report.mock.calls.filter(([notice])=>notice!==null).at(-1)?.[0].message).toContain('daily allowance');
});

it('keeps the sidebar status current even after overlay warnings have already been seen',async()=>{
 const status=vi.fn(),get=vi.mocked(window.sargosh!.usage!);
 await act(async()=>root.render(createElement(AllowanceWarning,{accountId:'account-a',enabled:true,onStatus:status})));
 expect(status).toHaveBeenLastCalledWith(null);
 get.mockResolvedValue(usage(50));await act(async()=>refresh());expect(status).toHaveBeenLastCalledWith('low');
 get.mockResolvedValue(usage(20));await act(async()=>refresh());expect(status).toHaveBeenLastCalledWith('low');
 get.mockResolvedValue(usage(0));await act(async()=>refresh());expect(status).toHaveBeenLastCalledWith('reached');
 get.mockResolvedValue(usage(600));await act(async()=>refresh());expect(status).toHaveBeenLastCalledWith(null);
 get.mockResolvedValue({...usage(600),monthlyUsedSeconds:6000});await act(async()=>refresh());expect(status).toHaveBeenLastCalledWith('reached');
 await act(async()=>root.render(createElement(AllowanceWarning,{accountId:'account-a',enabled:false,onStatus:status})));expect(status).toHaveBeenLastCalledWith(null);
});

it('polls every 30 seconds and syncs the page, sidebar and overlay without repeating warnings, including manual Refresh',async()=>{
 const status=vi.fn(),get=vi.mocked(window.sargosh!.usage!);
 await act(async()=>root.render(createElement(Fragment,null,createElement(AllowanceWarning,{accountId:'account-a',enabled:true,onStatus:status}),createElement(UsagePanel))));
 expect(get).toHaveBeenCalledOnce();expect(host.textContent).toContain('1m 1s remaining');expect(status).toHaveBeenLastCalledWith(null);
 get.mockResolvedValue(usage(60));await act(async()=>vi.advanceTimersByTime(30000));
 expect(get).toHaveBeenCalledTimes(2);expect(host.textContent).toContain('1m 0s remaining');expect(status).toHaveBeenLastCalledWith('low');
 expect(report.mock.calls.filter(([notice])=>notice!==null)).toHaveLength(1);
 get.mockResolvedValue(usage(35));await act(async()=>vi.advanceTimersByTime(30000));
 expect(host.textContent).toContain('0m 35s remaining');expect(report.mock.calls.filter(([notice])=>notice!==null)).toHaveLength(1);
 get.mockResolvedValue(usage(0));await act(async()=>(host.querySelector('.usage-heading button') as HTMLButtonElement).click());
 expect(get).toHaveBeenCalledTimes(4);expect(host.textContent).toContain('0m 0s remaining');expect(status).toHaveBeenLastCalledWith('reached');
 expect(report.mock.calls.filter(([notice])=>notice!==null)).toHaveLength(2);
 await act(async()=>vi.advanceTimersByTime(30000));expect(report.mock.calls.filter(([notice])=>notice!==null)).toHaveLength(2);
 expect(host.querySelector('.toast')).toBeNull();
 await act(async()=>root.render(null));const count=get.mock.calls.length;await act(async()=>vi.advanceTimersByTime(60000));expect(get).toHaveBeenCalledTimes(count);
});
it('defers polling during dictation and refreshes immediately when dictation completes',async()=>{
 const get=vi.mocked(window.sargosh!.usage!);await render();expect(get).toHaveBeenCalledOnce();
 runtime.busy=true;await render();await act(async()=>vi.advanceTimersByTime(60000));expect(get).toHaveBeenCalledOnce();
 get.mockResolvedValue(usage(45));runtime.busy=false;await render();expect(get).toHaveBeenCalledTimes(2);
 expect(report.mock.calls.filter(([notice])=>notice!==null).at(-1)?.[0].message).toContain('1 minute or less');
});
it('retries a failed scheduled refresh on the next interval',async()=>{
 const get=vi.mocked(window.sargosh!.usage!);await render();get.mockRejectedValueOnce(new Error('Offline'));
 await act(async()=>vi.advanceTimersByTime(30000));get.mockResolvedValue(usage(0));await act(async()=>vi.advanceTimersByTime(30000));
 expect(get).toHaveBeenCalledTimes(3);expect(report.mock.calls.filter(([notice])=>notice!==null).at(-1)?.[0].title).toBe('Allowance reached');
});

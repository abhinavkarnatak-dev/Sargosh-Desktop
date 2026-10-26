// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useMicrophones } from '../src/renderer/useMicrophones';
let host: HTMLDivElement, root: Root, media: EventTarget & {enumerateDevices: ReturnType<typeof vi.fn>; getUserMedia: ReturnType<typeof vi.fn>};
const mic = (id:string) => ({deviceId:id,kind:'audioinput',label:id}) as MediaDeviceInfo;
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 media=Object.assign(new EventTarget(),{enumerateDevices:vi.fn(async()=>[mic('USB microphone'),{kind:'videoinput',deviceId:'camera'}]),getUserMedia:vi.fn()});
 vi.stubGlobal('navigator',{mediaDevices:media});
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
function Example(){const[devices]=useMicrophones();return createElement('p',null,devices.map(value=>value.deviceId).join(','));}
it('lists microphones on opening without activating or recording any input',async()=>{
 await act(async()=>root.render(createElement(Example)));
 expect(host.textContent).toBe('USB microphone');expect(media.getUserMedia).not.toHaveBeenCalled();
});
it('refreshes after devices connect or disconnect and removes its listener on closing',async()=>{
 const remove=vi.spyOn(media,'removeEventListener');
 await act(async()=>root.render(createElement(Example)));
 media.enumerateDevices.mockResolvedValue([mic('Headset')]);
 await act(async()=>media.dispatchEvent(new Event('devicechange')));
 expect(host.textContent).toBe('Headset');
 media.enumerateDevices.mockResolvedValue([]);
 await act(async()=>media.dispatchEvent(new Event('devicechange')));expect(host.textContent).toBe('');
 await act(async()=>root.unmount());expect(remove).toHaveBeenCalledWith('devicechange',expect.any(Function));
 root=createRoot(host);
});
it('does not overwrite a newer device list with a late earlier enumeration',async()=>{
 let finish!:(value:MediaDeviceInfo[])=>void;
 media.enumerateDevices.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 await act(async()=>root.render(createElement(Example)));
 media.enumerateDevices.mockResolvedValue([mic('Latest microphone')]);
 await act(async()=>media.dispatchEvent(new Event('devicechange')));
 await act(async()=>finish([mic('Old microphone')]));expect(host.textContent).toBe('Latest microphone');
});
it('handles failed enumeration without an unhandled rejection',async()=>{
 media.enumerateDevices.mockRejectedValue(new Error('Device access unavailable'));
 await act(async()=>root.render(createElement(Example)));expect(host.textContent).toBe('');expect(media.getUserMedia).not.toHaveBeenCalled();
});

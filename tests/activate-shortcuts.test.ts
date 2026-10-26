import { expect,it,vi } from 'vitest';
import { activateShortcuts } from '../src/renderer/activate-shortcuts';
import { INITIAL_WINDOWS_STATE } from '../src/shared/windows';
import type { DesktopBridge } from '../src/shared/types';
it('serializes activation so duplicate startup effects do not register the same shortcut twice',async()=>{
 let state={...INITIAL_WINDOWS_STATE};
 const arm=vi.fn(async(shortcut:string)=>{state={...state,enabled:true,purpose:'recording',shortcut};return state;});
 const bridge={windowsStatus:async()=>state,startWindowsRecording:arm} as unknown as DesktopBridge;
 await Promise.all([activateShortcuts('Control+Alt+K',bridge),activateShortcuts('Control+Alt+K',bridge)]);
 expect(arm).toHaveBeenCalledExactlyOnceWith('Control+Alt+K');
});
it('does not replace a listening shortcut and permits retry after an activation error',async()=>{
 const arm=vi.fn(async()=>({...INITIAL_WINDOWS_STATE,enabled:true,purpose:'recording' as const}));
 const status=vi.fn(async()=>({...INITIAL_WINDOWS_STATE,phase:'listening' as const}));
 const bridge={windowsStatus:status,startWindowsRecording:arm} as unknown as DesktopBridge;
 await expect(activateShortcuts('Control+Alt+K',bridge)).rejects.toThrow('Finish your recording');expect(arm).not.toHaveBeenCalled();
 status.mockResolvedValueOnce({...INITIAL_WINDOWS_STATE} as any);await activateShortcuts('Control+Alt+K',bridge);expect(arm).toHaveBeenCalledOnce();
});

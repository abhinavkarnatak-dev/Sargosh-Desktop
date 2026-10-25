import { contextBridge, ipcRenderer } from 'electron';
import type { WindowsState } from '../shared/windows';
import type { DesktopBridge } from '../shared/types';
const bridge: DesktopBridge = {
  windowsStatus: () => ipcRenderer.invoke('sargosh:windows-status'),
  startWindowsTest: shortcut => ipcRenderer.invoke('sargosh:windows-start', shortcut),
  windowsAction: action => ipcRenderer.invoke('sargosh:windows-action', action),
  insertWindowsTest: sessionId => ipcRenderer.invoke('sargosh:windows-insert-test', sessionId),
  onWindowsState: listener => {
    const handler = (_event: Electron.IpcRendererEvent, state: WindowsState) => listener(state);
    ipcRenderer.on('sargosh:windows-state', handler);
    return () => { ipcRenderer.removeListener('sargosh:windows-state', handler); };
  },
  snapshot: () => ipcRenderer.invoke('sargosh:snapshot'),
  preferences: update => ipcRenderer.invoke('sargosh:preferences', update),
  status: () => ipcRenderer.invoke('sargosh:status'),
  openMain: () => ipcRenderer.invoke('sargosh:open-main'),
  moveOverlay: (dx, dy) => ipcRenderer.invoke('sargosh:move-overlay', { dx, dy }),
  deleteEntry: id => ipcRenderer.invoke('sargosh:delete', id)
};
contextBridge.exposeInMainWorld('sargosh', bridge);

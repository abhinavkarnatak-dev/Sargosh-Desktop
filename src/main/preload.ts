import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '../shared/types';
const bridge: DesktopBridge = {
  snapshot: () => ipcRenderer.invoke('sargosh:snapshot'),
  preferences: update => ipcRenderer.invoke('sargosh:preferences', update),
  status: () => ipcRenderer.invoke('sargosh:status'),
  openMain: () => ipcRenderer.invoke('sargosh:open-main'),
  moveOverlay: (dx, dy) => ipcRenderer.invoke('sargosh:move-overlay', { dx, dy }),
  deleteEntry: id => ipcRenderer.invoke('sargosh:delete', id)
};
contextBridge.exposeInMainWorld('sargosh', bridge);

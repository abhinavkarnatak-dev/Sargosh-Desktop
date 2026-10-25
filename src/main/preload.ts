import { contextBridge, ipcRenderer } from 'electron';
import type { TranscriptionStatus } from '../shared/transcription';
import type { RecordingState } from '../shared/recording';
import type { WindowsState } from '../shared/windows';
import type { DesktopBridge } from '../shared/types';
const bridge: DesktopBridge = {
  transcribeAudio: request => ipcRenderer.invoke('sargosh:transcribe', request),
  cancelTranscription: requestId => ipcRenderer.invoke('sargosh:transcription-cancel', requestId),
  reportTranscription: status => ipcRenderer.invoke('sargosh:transcription-report', status),
  transcriptionStatus: () => ipcRenderer.invoke('sargosh:transcription-status'),
  onTranscriptionState: listener => {
    const handler = (_event: Electron.IpcRendererEvent, status: TranscriptionStatus) => listener(status);
    ipcRenderer.on('sargosh:transcription-state', handler);
    return () => { ipcRenderer.removeListener('sargosh:transcription-state', handler); };
  },
  startWindowsRecording: shortcut => ipcRenderer.invoke('sargosh:recording-start', shortcut),
  reportRecording: state => ipcRenderer.invoke('sargosh:recording-report', state),
  recordingStatus: () => ipcRenderer.invoke('sargosh:recording-status'),
  recordingAction: action => ipcRenderer.invoke('sargosh:recording-action', action),
  onRecordingState: listener => {
    const handler = (_event: Electron.IpcRendererEvent, state: RecordingState) => listener(state);
    ipcRenderer.on('sargosh:recording-state', handler);
    return () => { ipcRenderer.removeListener('sargosh:recording-state', handler); };
  },
  onRecordingCommand: listener => {
    const handler = (_event: Electron.IpcRendererEvent, action: 'cancel' | 'finish') => listener(action);
    ipcRenderer.on('sargosh:recording-command', handler);
    return () => { ipcRenderer.removeListener('sargosh:recording-command', handler); };
  },
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

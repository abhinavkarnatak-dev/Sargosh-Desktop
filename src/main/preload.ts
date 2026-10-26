import { contextBridge, ipcRenderer } from 'electron';
import type { TranscriptionStatus } from '../shared/transcription';
import type { RecordingState } from '../shared/recording';
import type { WindowsState } from '../shared/windows';
import type { DesktopBridge } from '../shared/types';
async function authCall(channel: string, value?: unknown) {
  try { return value === undefined ? await ipcRenderer.invoke(channel) : await ipcRenderer.invoke(channel, value); }
  catch (error) {
    const text = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '';
    throw new Error(text && text.length <= 400 ? text : 'Sign-in could not complete. Please try again.');
  }
}
const bridge: DesktopBridge = {
  startupReady: () => ipcRenderer.send('sargosh:ui-ready'),
  usage: () => authCall('sargosh:usage'),
  authState: () => authCall('sargosh:auth-state'),
  onAuthState: listener => { const handler = (_event: Electron.IpcRendererEvent, state: import('../shared/auth').AuthState) => listener(state); ipcRenderer.on('sargosh:auth-state', handler); return () => { ipcRenderer.removeListener('sargosh:auth-state', handler); }; },
  sendEmailCode: email => authCall('sargosh:auth-send-code', email),
  verifyEmailCode: (email, code) => authCall('sargosh:auth-verify-code', { email, code }),
  signInGoogle: () => authCall('sargosh:auth-google'),
  cancelGoogleSignIn: () => authCall('sargosh:auth-google-cancel'),
  signOut: () => authCall('sargosh:auth-sign-out'),
  deleteAccount: confirmation => authCall('sargosh:auth-delete', confirmation),
  completeOnboarding: () => authCall('sargosh:auth-onboarding'),
  updateProfile: (firstName, lastName) => authCall('sargosh:auth-profile', { firstName, lastName }),
  saveHistory: request => ipcRenderer.invoke('sargosh:history-save', request),
  updateHistory: request => ipcRenderer.invoke('sargosh:history-update', request),
  listHistory: cursor => ipcRenderer.invoke('sargosh:history-list', cursor),
  historyAudio: id => ipcRenderer.invoke('sargosh:history-audio', id),
  retryHistory: id => ipcRenderer.invoke('sargosh:history-retry', id),
  extractHistoryAudio: id => ipcRenderer.invoke('sargosh:history-extract', id),
  copyHistoryText: id => ipcRenderer.invoke('sargosh:history-copy', id),
  onHistoryChanged: listener => {
    const handler = () => listener(); ipcRenderer.on('sargosh:history-changed', handler);
    return () => { ipcRenderer.removeListener('sargosh:history-changed', handler); };
  },
  setWindowTheme: theme => ipcRenderer.invoke('sargosh:window-theme', theme),
  copyOverlayText: id => ipcRenderer.invoke('sargosh:overlay-copy', id),
  resizeOverlay: height => ipcRenderer.invoke('sargosh:overlay-resize', height),
  openSettings: () => ipcRenderer.invoke('sargosh:open-settings'),
  onOpenSettings: listener => {
    const handler = () => listener();
    ipcRenderer.on('sargosh:open-settings', handler);
    return () => { ipcRenderer.removeListener('sargosh:open-settings', handler); };
  },
  deliverText: request => ipcRenderer.invoke('sargosh:deliver-text', request),
  cancelDelivery: sessionId => ipcRenderer.invoke('sargosh:delivery-cancel', sessionId),
  cleanupTranscript: request => ipcRenderer.invoke('sargosh:cleanup', request),
  practiceTranscribeAudio: request => ipcRenderer.invoke('sargosh:practice-transcribe', request),
  practiceCleanupTranscript: request => ipcRenderer.invoke('sargosh:practice-cleanup', request),
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
    const handler = async (_event: Electron.IpcRendererEvent, command: 'cancel' | 'finish' | { id: string; action: 'cancel' | 'finish' }) => {
      // Plain commands are coordinator shutdown/cancellation notifications.
      const action = typeof command === 'string' ? command : command.action;
      let ok = false;
      try { await listener(action); ok = true; } catch { /* Report failure to the requesting overlay. */ }
      finally {
        if (typeof command !== 'string') void ipcRenderer.invoke('sargosh:recording-command-result', { id: command.id, ok }).catch(() => {});
      }
    };
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

import { useSyncExternalStore } from 'react';
import { DEFAULT_PREFERENCES, type Preferences } from '../../shared/types';
import type { WindowsState } from '../../shared/windows';
import { RecordingController } from './controller';
import { BrowserAudioBackend } from './browser';
import { TranscriptionController } from './transcription';
import { transcriptionTransport } from './transcription-transport';
import { recordingBusy } from '../../shared/recording';

let preferences: Preferences = DEFAULT_PREFERENCES;
let native: WindowsState | undefined;
let initialized = false;
let activeBefore = false;
let stopping = false;
let sourceSession: string | null = null;
let automaticSession: string | null = null;
export const transcription = new TranscriptionController(transcriptionTransport);
export const useTranscription = () => useSyncExternalStore(transcription.subscribe, transcription.getState);
export async function transcribeRecording() {
  const state = recording.getState(); const blob = recording.getClip();
  if (state.phase === 'ready' && state.sessionId && blob) await transcription.start(state.sessionId, blob);
}
export const recording = new RecordingController(new BrowserAudioBackend(), () => performance.now(), () => { void finishRecording(); });
export const useRecording = () => useSyncExternalStore(recording.subscribe, recording.getState);
export function setRecordingPreferences(value: Preferences) { preferences = value; }
export async function finishRecording() {
  if (stopping) return;
  stopping = true;
  try {
    if (native?.purpose === 'recording' && native.enabled && native.sessionId === recording.getState().sessionId && ['pending', 'listening'].includes(native.phase)) {
      if (native.phase === 'pending') { cancelRecording(); return; }
      const state = await window.sargosh!.windowsAction('finish'); native = state; recording.native(state, preferences.microphoneId);
    } else await recording.finish();
  } catch { cancelRecording(); }
  finally { stopping = false; }
}
export function cancelRecording() {
  transcription.cancel();
  recording.cancel();
  if (native?.purpose === 'recording' && native.enabled && ['pending', 'listening', 'finished'].includes(native.phase)) {
    void window.sargosh?.windowsAction('cancel').catch(() => {});
  }
}
export async function startRecording() {
  if (recordingBusy(recording.getState()) || transcription.getState().phase === 'working') return;
  if (native?.purpose === 'recording' && native.enabled) {
    const state = await window.sargosh!.windowsAction('start-hands-free');
    native = state; recording.native(state, preferences.microphoneId);
  } else {
    if (native?.enabled) await window.sargosh?.windowsAction('disarm');
    recording.begin(crypto.randomUUID(), preferences.microphoneId, 'manual');
  }
}
export function initializeRecording() {
  if (initialized) return;
  initialized = true;
  recording.subscribe(() => {
    const state = recording.getState();
    if (state.sessionId !== sourceSession) { sourceSession = state.sessionId; transcription.clear(); }
    if (['idle', 'cancelled', 'failed'].includes(state.phase)) transcription.clear();
    void window.sargosh?.reportRecording(state).catch(() => {});
    if (state.phase === 'ready' && state.sessionId && transcription.getState().automatic && automaticSession !== state.sessionId) {
      automaticSession = state.sessionId; void transcribeRecording();
    }
    // A timeout, microphone failure, or automatic finish must also end native tracking.
    const busy = recordingBusy(state);
    if (activeBefore && !busy && native?.purpose === 'recording' && native.enabled && ['pending', 'listening'].includes(native.phase)) {
      void window.sargosh?.windowsAction('cancel').catch(() => {});
    }
    activeBefore = busy;
  });
  transcription.subscribe(() => {
    const { phase, message } = transcription.getState();
    void window.sargosh?.reportTranscription({ phase, message }).catch(() => {});
  });
  if (window.sargosh) {
    const update = (state: WindowsState) => {
      if (native && state.revision < native.revision) return;
      native = state;
      if (transcription.getState().phase === 'working' && state.purpose === 'recording' && ['pending', 'listening'].includes(state.phase) && state.sessionId !== recording.getState().sessionId) {
        void window.sargosh!.windowsAction('cancel').catch(() => {}); return;
      }
      if (!recording.native(state, preferences.microphoneId) && state.purpose === 'recording') {
        void window.sargosh!.windowsAction('cancel').catch(() => {});
      }
    };
    window.sargosh.onWindowsState(update);
    void window.sargosh.windowsStatus().then(update).catch(() => {});
    void window.sargosh.snapshot().then(snapshot => { preferences = snapshot.preferences; }).catch(() => {});
    window.sargosh.onRecordingCommand(action => {
      if (action === 'cancel') cancelRecording();
      else if (action === 'finish') void finishRecording();
    });
    void window.sargosh.reportRecording(recording.getState()).catch(() => {});
    void window.sargosh.reportTranscription({ phase: 'idle', message: '' }).catch(() => {});
  }
  window.addEventListener('pagehide', () => {
    recording.clear();
    if (native?.purpose === 'recording' && native.enabled) void window.sargosh?.windowsAction('disarm').catch(() => {});
  }, { once: true });
}
if (import.meta.hot) import.meta.hot.dispose(() => {
  recording.clear();
  if (native?.purpose === 'recording' && native.enabled) void window.sargosh?.windowsAction('disarm').catch(() => {});
  // Rebuild the owner and its subscriptions together during development.
  window.location.reload();
});

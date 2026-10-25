import { useSyncExternalStore } from 'react';
import { DEFAULT_PREFERENCES, type Preferences } from '../../shared/types';
import type { WindowsState } from '../../shared/windows';
import { RecordingController } from './controller';
import { BrowserAudioBackend } from './browser';
import type { Transcript, TranscriptionStatus } from '../../shared/transcription';
import { CleanupController } from './cleanup';
import { cleanupTransport } from './cleanup-transport';
import { TranscriptionController } from './transcription';
import { transcriptionTransport } from './transcription-transport';
import { recordingBusy } from '../../shared/recording';

let preferences: Preferences = DEFAULT_PREFERENCES;
let native: WindowsState | undefined;
let initialized = false;
let activeBefore = false;
let sourceSession: string | null = null;
let automaticSession: string | null = null;
let cleanupSource: Transcript | null = null;
export const cleanup = new CleanupController(cleanupTransport);
export const useCleanup = () => useSyncExternalStore(cleanup.subscribe, cleanup.getState);
export const cloudBusy = () => transcription.getState().phase === 'working' || cleanup.getState().phase === 'working';
export async function cleanupTranscript() {
  const state = transcription.getState();
  if (state.phase === 'completed' && state.sessionId && state.result && !cloudBusy()) await cleanup.start(state.sessionId, state.result.text, state.result.language);
}
export const transcription = new TranscriptionController(transcriptionTransport);
export const useTranscription = () => useSyncExternalStore(transcription.subscribe, transcription.getState);
export async function transcribeRecording() {
  const state = recording.getState(); const blob = recording.getClip();
  if (state.phase === 'ready' && state.sessionId && blob && !cloudBusy()) await transcription.start(state.sessionId, blob);
}
export const recording = new RecordingController(new BrowserAudioBackend(), () => performance.now(), () => { void finishRecording(); });
export const useRecording = () => useSyncExternalStore(recording.subscribe, recording.getState);
export function setRecordingPreferences(value: Preferences) { preferences = value; }
export async function finishRecording() {
  const sessionId = recording.getState().sessionId;
  if (native?.purpose === 'recording' && native.enabled && native.sessionId === sessionId && ['pending', 'listening'].includes(native.phase)) {
    if (native.phase === 'pending') { cancelRecording(); return; }
    // Stop capture now, but do not publish/upload until Windows freezes the target.
    await recording.finish(sessionId, async () => {
      const state = await window.sargosh!.windowsAction('finish');
      if (recording.getState().sessionId !== sessionId) return;
      if (state.sessionId !== sessionId || state.phase !== 'finished') throw new Error('Destination could not be frozen.');
      if (!native || state.revision >= native.revision) native = state;
      recording.native(state, preferences.microphoneId);
    });
  } else await recording.finish();
}
export function cancelRecording() {
  cleanup.cancel();
  transcription.cancel();
  recording.cancel();
  if (native?.purpose === 'recording' && native.enabled && ['pending', 'listening', 'finished'].includes(native.phase)) {
    void window.sargosh?.windowsAction('cancel').catch(() => {});
  }
}
export async function startRecording() {
  if (recordingBusy(recording.getState()) || cloudBusy()) return;
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
  const reportCloud = () => {
    const speech = transcription.getState(); const clean = cleanup.getState();
    const status: TranscriptionStatus = clean.phase === 'working' ? { phase: 'working', message: clean.message } :
      clean.phase === 'completed' ? { phase: 'completed', message: clean.message } : { phase: speech.phase, message: speech.message };
    void window.sargosh?.reportTranscription(status).catch(() => {});
  };
  cleanup.subscribe(reportCloud);
  transcription.subscribe(() => {
    const speech = transcription.getState();
    if (speech.phase !== 'completed') { cleanupSource = null; cleanup.clear(); }
    if (speech.phase === 'completed' && speech.result && speech.result !== cleanupSource) {
      cleanupSource = speech.result;
      if (cleanup.getState().enabled) void cleanupTranscript();
    }
    reportCloud();
  });
  if (window.sargosh) {
    const update = (state: WindowsState) => {
      if (native && state.revision < native.revision) return;
      native = state;
      if (cloudBusy() && state.purpose === 'recording' && ['pending', 'listening'].includes(state.phase) && state.sessionId !== recording.getState().sessionId) {
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
      else if (action === 'finish') return finishRecording();
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

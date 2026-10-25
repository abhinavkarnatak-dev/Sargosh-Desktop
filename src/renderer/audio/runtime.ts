import { DeliveryController, deliveryTransport } from './delivery';
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
let recovery: { sessionId: string; text: string; id: string } | null = null;
export const delivery = new DeliveryController(deliveryTransport);
export const useDelivery = () => useSyncExternalStore(delivery.subscribe, delivery.getState);
export const cleanup = new CleanupController(cleanupTransport);
export const useCleanup = () => useSyncExternalStore(cleanup.subscribe, cleanup.getState);
export const cloudBusy = () => transcription.getState().phase === 'working' || cleanup.getState().phase === 'working' || delivery.getState().phase === 'working';
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
  delivery.cancel();
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
    if (state.sessionId !== sourceSession) { sourceSession = state.sessionId; recovery = null; delivery.clear(); transcription.clear(); }
    if (['idle', 'cancelled', 'failed'].includes(state.phase)) { delivery.clear(); transcription.clear(); }
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
  const maybeDeliver = () => {
    const audio = recording.getState(); const speech = transcription.getState(); const clean = cleanup.getState();
    if (!window.sargosh?.deliverText || audio.phase !== 'ready' || audio.mode === 'manual' || !audio.sessionId ||
        speech.phase !== 'completed' || speech.sessionId !== audio.sessionId || !speech.result?.text ||
        native?.sessionId !== audio.sessionId || native.purpose !== 'recording' || native.phase !== 'finished' || !native.enabled) return;
    const text = clean.phase === 'completed' && clean.sessionId === audio.sessionId && clean.result ? clean.result.text :
      !clean.enabled && clean.phase === 'idle' ? speech.result.text : null;
    if (!text) return;
    if (!audio.target) { delivery.unavailable(audio.sessionId); return; }
    void delivery.start({ sessionId: audio.sessionId, targetId: audio.target.id, text });
  };
  const reportCloud = () => {
    const speech = transcription.getState(); const clean = cleanup.getState(); const insertion = delivery.getState();
    const status: TranscriptionStatus = insertion.phase === 'working' ? { phase: 'working', message: insertion.message } : clean.phase === 'working' ? { phase: 'working', message: clean.message } :
      speech.phase === 'working' ? { phase: 'working', message: speech.message } : insertion.phase !== 'idle' ? { phase: insertion.phase, message: insertion.message } :
      clean.phase !== 'idle' ? { phase: clean.phase, message: clean.message } : { phase: speech.phase, message: speech.message };
    const sessionId = speech.sessionId ?? recording.getState().sessionId;
    const finalText = clean.result?.text || speech.result?.text;
    if (sessionId && status.phase !== 'working') {
      const id = sessionId + ':' + status.phase;
      if (insertion.phase === 'failed' && finalText) {
        if (!recovery || recovery.sessionId !== sessionId || recovery.text !== finalText) recovery = { sessionId, text: finalText, id: crypto.randomUUID() };
        status.notice = { id: recovery.id, kind: 'recovery', title: 'Your text is ready', message: 'We could not insert it into a textbox. Copy it below. If some text was inserted, check the textbox before pasting.', text: finalText };
      }
      else if (insertion.phase === 'cancelled') status.notice = { id: id + ':delivery', kind: 'info', title: 'Insertion stopped', message: insertion.message };
      else if (clean.phase === 'failed') status.notice = { id: id + ':cleanup', kind: 'error', title: 'Could not prepare your text', message: 'Please try again in Sargosh. Your original transcript is still available.' };
      else if (clean.phase === 'cancelled' || speech.phase === 'cancelled') status.notice = { id: id + ':cancelled', kind: 'info', title: 'Dictation cancelled', message: 'Processing stopped. No new text was inserted.' };
      else if (speech.phase === 'failed') status.notice = { id: id + ':speech', kind: 'error', title: 'Could not prepare your text', message: speech.message };
      else if (speech.phase === 'completed' && speech.result && !speech.result.text.trim()) status.notice = { id: id + ':empty', kind: 'error', title: 'No speech detected', message: 'We did not recognize any words. Check your microphone and try again.' };
    }
    void window.sargosh?.reportTranscription(status).catch(() => {});
  };
  delivery.subscribe(reportCloud);
  cleanup.subscribe(() => { maybeDeliver(); reportCloud(); });
  transcription.subscribe(() => {
    const speech = transcription.getState();
    if (speech.phase !== 'completed') { cleanupSource = null; cleanup.clear(); }
    if (speech.phase === 'completed' && speech.result && speech.result !== cleanupSource) {
      cleanupSource = speech.result;
      if (cleanup.getState().enabled) void cleanupTranscript();
    }
    maybeDeliver(); reportCloud();
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

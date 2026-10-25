import type { WindowsState } from './windows';
export type RecordingPhase = 'idle' | 'opening' | 'recording' | 'finishing' | 'ready' | 'cancelled' | 'failed';
export interface RecordingState {
  revision: number;
  phase: RecordingPhase;
  sessionId: string | null;
  mode: 'hold' | 'hands-free' | 'manual' | null;
  durationMs: number;
  level: number;
  quiet: boolean;
  message: string;
  clip: { bytes: number; mimeType: string } | null;
  target: WindowsState['target'];
}
export const INITIAL_RECORDING_STATE: RecordingState = {
  revision: 0, phase: 'idle', sessionId: null, mode: null, durationMs: 0, level: 0,
  quiet: false, message: 'Record a local clip to check the full recording flow.', clip: null, target: null
};
export const MAX_RECORDING_MS = 5 * 60_000;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const recordingBusy = (state: RecordingState) => ['opening', 'recording', 'finishing'].includes(state.phase);

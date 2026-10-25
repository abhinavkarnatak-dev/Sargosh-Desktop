import type { RecordingState } from './recording';
import type { TranscriptionStatus } from './transcription';
export interface OverlayNotice { id: string; kind: 'error' | 'info' | 'recovery'; title: string; message: string; text?: string }
export function validOverlayNotice(value: unknown): value is OverlayNotice {
  if (!value || typeof value !== 'object') return false;
  const notice = value as OverlayNotice;
  return typeof notice.id === 'string' && notice.id.length > 0 && notice.id.length <= 150 &&
    ['error', 'info', 'recovery'].includes(notice.kind) && typeof notice.title === 'string' && notice.title.length <= 100 &&
    typeof notice.message === 'string' && notice.message.length <= 400 &&
    (notice.text === undefined || typeof notice.text === 'string' && notice.text.length <= 24000);
}
export function recordingNotice(audio: RecordingState, speech: TranscriptionStatus): OverlayNotice | null {
  if (speech.phase === 'working' || audio.phase === 'finishing') return null;
  const id = 'recording:' + (audio.sessionId ?? audio.revision);
  if (audio.phase === 'recording' && audio.quiet) return { id: id + ':quiet', kind: 'error', title: 'No microphone activity', message: 'We cannot hear any sound. Check that your microphone is connected and not muted.' };
  if (audio.phase === 'opening' || audio.phase === 'recording') return null;
  if (audio.phase === 'failed') return { id: id + ':failed', kind: 'error', title: 'Recording unavailable', message: audio.message };
  if (audio.phase === 'cancelled') return { id: id + ':cancelled', kind: 'info', title: 'Recording cancelled', message: 'Your recording was discarded. No text was inserted.' };
  return speech.notice ?? null;
}

export function recoveryTextForCopy(status: TranscriptionStatus, id: unknown): string {
  const notice = status.notice;
  if (status.phase === 'working' || typeof id !== 'string' || !notice || notice.kind !== 'recovery' || notice.id !== id || !notice.text) throw new Error('This text is no longer available.');
  return notice.text;
}

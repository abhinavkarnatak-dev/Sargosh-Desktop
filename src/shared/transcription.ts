import type { OverlayNotice } from './overlay-notice';
export const STT_LANGUAGES = [
  { value: 'en', label: 'English' }, { value: 'hi', label: 'Hindi' },
  { value: 'multi', label: 'Hinglish' }
] as const;
export type SpeechLanguage = typeof STT_LANGUAGES[number]['value'];
export const isSpeechLanguage = (value: unknown): value is SpeechLanguage => STT_LANGUAGES.some(item => item.value === value);
export interface Transcript {
  text: string; language: SpeechLanguage; model: 'nova-3'; durationMs: number; confidence: number | null;
}
export type TranscriptionPhase = 'idle' | 'working' | 'completed' | 'failed' | 'cancelled';
export interface TranscriptionStatus { phase: TranscriptionPhase; message: string; notice?: OverlayNotice }
export interface TranscriptionState extends TranscriptionStatus {
  sessionId: string | null; result: Transcript | null; language: SpeechLanguage; automatic: boolean;
}
export const INITIAL_TRANSCRIPTION: TranscriptionState = {
  phase: 'idle', message: '', sessionId: null, result: null, language: 'en', automatic: true
};
export interface TranscriptionRequest {
  practice?: boolean; requestId: string; audio: ArrayBuffer; mimeType: string; language: SpeechLanguage;
}
export const isRequestId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(value);
export const AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/mp4'];
export function audioType(value: string): string | null {
  const type = value.split(';')[0].trim().toLowerCase();
  return AUDIO_TYPES.includes(type) ? type : null;
}

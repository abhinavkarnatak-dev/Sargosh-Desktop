import type { SpeechLanguage, Transcript } from './transcription';
export const STREAM_SAMPLE_RATE = 16000;
export const STREAM_BYTES_PER_SECOND = STREAM_SAMPLE_RATE * 2;
export const STREAM_MAX_CHUNK = STREAM_BYTES_PER_SECOND; // At most one second per frame.
export const STREAM_MAX_BUFFER = STREAM_BYTES_PER_SECOND * 15;
export interface StreamRequest { requestId: string; traceId: string; language: SpeechLanguage; cleanup: boolean }
export type StreamStart = { ok: true } | { ok: false; code: string; message: string };
export type StreamResult = { ok: true; result: Transcript } | { ok: false; code: string; message: string };

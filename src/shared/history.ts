import type { SpeechLanguage } from './transcription';
export interface HistoryCapture { id: string; audio: ArrayBuffer; mimeType: string; language: SpeechLanguage; cleanupEnabled: boolean }
export interface HistoryResult { id: string; text: string; originalText: string; language: SpeechLanguage; cleanupEnabled: boolean; status: 'completed' | 'failed'; error?: string }
export interface HistoryCursor { createdAt: string; id: string }
export interface HistoryPage { entries: import('./types').HistoryEntry[]; hasMore: boolean }
export const isHistoryId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export function countWords(text: string): number { return [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)].filter(segment => segment.isWordLike).length; }

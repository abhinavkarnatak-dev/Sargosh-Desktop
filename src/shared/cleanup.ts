import type { SpeechLanguage } from './transcription';
export const GEMINI_CLEANUP_MODELS = ['gemini-2.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'] as const;
export type GeminiCleanupModel = typeof GEMINI_CLEANUP_MODELS[number];
export const OPENAI_CLEANUP_MODEL = 'gpt-6-luna' as const;
export const CLEANUP_MODELS = [...GEMINI_CLEANUP_MODELS, OPENAI_CLEANUP_MODEL] as const;
export const isGeminiCleanupModel = (value: unknown): value is GeminiCleanupModel => GEMINI_CLEANUP_MODELS.some(model => model === value);
export type CleanupModel = typeof CLEANUP_MODELS[number];
export const DEFAULT_CLEANUP_MODEL: GeminiCleanupModel = 'gemini-3.5-flash-lite';
export const isCleanupModel = (value: unknown): value is CleanupModel => CLEANUP_MODELS.some(model => model === value);
export const MAX_CLEANUP_CHARS = 24_000;
export interface CleanupRequest { traceId?: string; practice?: boolean; requestId: string; text: string; language: SpeechLanguage }
export interface CleanupResult { text: string; model: CleanupModel; serviceTier?: 'fast' | 'priority' | 'default' }
export interface CleanupState {
  phase: 'idle' | 'working' | 'completed' | 'failed' | 'cancelled';
  sessionId: string | null; enabled: boolean; result: CleanupResult | null; message: string;
}
export const INITIAL_CLEANUP: CleanupState = { phase: 'idle', sessionId: null, enabled: true, result: null, message: '' };

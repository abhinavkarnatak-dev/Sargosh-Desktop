import { DEFAULT_CLEANUP_MODEL, OPENAI_CLEANUP_MODEL, type GeminiCleanupModel } from '../shared/cleanup';
import type { SpeechLanguage } from '../shared/transcription';
import { cleanTranscript } from './gemini';
import { CleanupError } from './cleanup-common';
import { cleanWithOpenAI, type CleanupUsage } from './openai';
import type { ProviderMeasure } from './timing';
export interface CleanupProviderOptions {
  cleanupProvider?: 'openai' | 'gemini'; openaiApiKey?: string; openaiFetcher?: typeof fetch;
  geminiApiKey?: string; geminiModel?: GeminiCleanupModel; geminiFetcher?: typeof fetch;
}
export function createCleanupProvider(options: CleanupProviderOptions) {
  const provider = options.cleanupProvider ?? (options.openaiApiKey ? 'openai' : 'gemini');
  const model = provider === 'openai' ? OPENAI_CLEANUP_MODEL : options.geminiModel ?? DEFAULT_CLEANUP_MODEL;
  const configured = Boolean(provider === 'openai' ? options.openaiApiKey : options.geminiApiKey);
  return {
    provider, model, configured,
    fingerprint: provider + ':' + model + (provider === 'openai' ? ':fast:none' : ''),
    async clean(input: { text: string; language: SpeechLanguage; signal: AbortSignal; measure?: ProviderMeasure; onUsage?: (usage: CleanupUsage) => void }) {
      if (!configured) throw new CleanupError('CLEANUP_NOT_CONFIGURED', 'The selected cleanup provider is not configured. The original transcript is available.', 503);
      // Explicit selection never falls back to another provider/model/tier.
      return provider === 'openai'
        ? cleanWithOpenAI({ ...input, apiKey: options.openaiApiKey!, fetcher: options.openaiFetcher })
        : cleanTranscript({ ...input, apiKey: options.geminiApiKey!, model: options.geminiModel ?? DEFAULT_CLEANUP_MODEL, fetcher: options.geminiFetcher });
    }
  };
}

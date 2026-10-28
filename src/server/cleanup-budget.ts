import { DEFAULT_CLEANUP_MODEL, type CleanupModel } from '../shared/cleanup';
import type { SpeechLanguage } from '../shared/transcription';
import { cleanupInstructions } from './cleanup-prompt';
import { CLEANUP_MAX_ATTEMPTS, cleanupOutputLimit } from './cleanup-common';
// Micro-dollars per token. Luna uses Fast-tier prices; Gemini legacy rates
// remain conservative. Reservations include both possible provider attempts.
const prices = (model: CleanupModel, serviceTier?: string) => model === 'gpt-6-luna'
  ? serviceTier === 'default' ? { input: .10, output: .50 } : { input: .20, output: 1.00 }
  : { input: .30, output: 2.50 };
export function cleanupAttemptCost(text: string, language: SpeechLanguage, model: CleanupModel = DEFAULT_CLEANUP_MODEL) {
  const rate = prices(model);
  return Math.ceil((Buffer.byteLength(JSON.stringify({ language, transcript: text })) + Buffer.byteLength(cleanupInstructions(language)) + 1024) * rate.input + cleanupOutputLimit(text) * rate.output);
}
export const cleanupReservationCost = (text: string, language: SpeechLanguage, model: CleanupModel = DEFAULT_CLEANUP_MODEL) => cleanupAttemptCost(text, language, model) * CLEANUP_MAX_ATTEMPTS;
export function cleanupActualCost(usage: { inputTokens: number; outputTokens: number; uncertainAttempts?: number; serviceTier?: string }, text: string, language: SpeechLanguage, model: CleanupModel = DEFAULT_CLEANUP_MODEL) {
  // A failed attempt may have been billed. Hold its full per-attempt estimate;
  // reconcile only the completed attempt using returned usage metadata.
  const rate = prices(model, usage.serviceTier);
  return Math.ceil(usage.inputTokens * rate.input + usage.outputTokens * rate.output) + (usage.uncertainAttempts ?? 0) * cleanupAttemptCost(text, language, model);
}

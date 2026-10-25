import { normalizeDashes } from '../shared/lifecycle';
import { MAX_CLEANUP_CHARS, type CleanupModel, type CleanupResult } from '../shared/cleanup';
import type { SpeechLanguage } from '../shared/transcription';
import { CLEANUP_INSTRUCTIONS } from './cleanup-prompt';
export class CleanupError extends Error {
  constructor(public code: string, message: string, public status = 502) { super(message); }
}
async function readResponse(response: Response): Promise<unknown> {
  if (!response.body) throw new CleanupError('GEMINI_RESPONSE', 'Gemini returned an unreadable response. The original transcript is available.');
  const chunks: Uint8Array[] = []; let length = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > 512 * 1024) { await reader.cancel(); throw new Error('Response too large'); }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw new CleanupError('GEMINI_RESPONSE', 'Gemini returned an unreadable response. The original transcript is available.'); }
}
export const cleanupOutputLimit = (text: string) => Math.min(16384, Math.max(512, text.length * 2 + 128));
export async function cleanTranscript(options: {
  apiKey: string; model: CleanupModel; text: string; language: SpeechLanguage; signal: AbortSignal; fetcher?: typeof fetch; onUsage?: (usage: {inputTokens:number;outputTokens:number}) => void;
}): Promise<CleanupResult> {
  if (!options.text.trim() || options.text.length > MAX_CLEANUP_CHARS) throw new CleanupError('CLEANUP_INPUT', 'This transcript is empty or exceeds the cleanup limit.', 400);
  const timeout = AbortSignal.timeout(20_000);
  const signal = AbortSignal.any([timeout, options.signal]);
  try {
    const response = await (options.fetcher || fetch)('https://generativelanguage.googleapis.com/v1beta/models/' + options.model + ':generateContent', {
      method: 'POST', redirect: 'error', signal,
      headers: { 'x-goog-api-key': options.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: CLEANUP_INSTRUCTIONS }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify({ language: options.language, transcript: options.text }) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
          maxOutputTokens: cleanupOutputLimit(options.text)
        }
      })
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      if (response.status === 401 || response.status === 403) throw new CleanupError('GEMINI_AUTH', 'Gemini rejected the key or project access. Check the private backend credentials.', 503);
      if (response.status === 404) throw new CleanupError('GEMINI_MODEL', 'The selected Flash-Lite model is unavailable for this key. Check GEMINI_MODEL in the backend .env.', 503);
      if (response.status === 429) throw new CleanupError('GEMINI_QUOTA', 'Gemini quota or rate limit reached. Check the project quota and try later.', 429);
      if (response.status === 400) throw new CleanupError('GEMINI_REQUEST', 'Gemini rejected the cleanup request. The original transcript is available.', 502);
      throw new CleanupError('GEMINI_UNAVAILABLE', 'Gemini is temporarily unavailable. The original transcript is available.');
    }
    const data = await readResponse(response) as {
      usageMetadata?: {promptTokenCount?:number;totalTokenCount?:number};
      promptFeedback?: { blockReason?: unknown };
      candidates?: { finishReason?: string; content?: { parts?: { text?: unknown; thought?: boolean; functionCall?: unknown }[] } }[];
    };
    const usage=data?.usageMetadata;
    if(Number.isSafeInteger(usage?.promptTokenCount)&&Number.isSafeInteger(usage?.totalTokenCount)&&usage!.promptTokenCount!>=0&&usage!.totalTokenCount!>=usage!.promptTokenCount!) options.onUsage?.({inputTokens:usage!.promptTokenCount!,outputTokens:usage!.totalTokenCount!-usage!.promptTokenCount!});
    const candidate = data?.candidates?.[0];
    if (data?.promptFeedback?.blockReason || candidate?.finishReason === 'SAFETY' || candidate?.finishReason === 'RECITATION') throw new CleanupError('GEMINI_BLOCKED', 'Gemini could not clean this transcript. The original is available.');
    if (!candidate || candidate.finishReason !== 'STOP') throw new CleanupError('GEMINI_INCOMPLETE', 'Gemini did not finish the cleanup. The original transcript is available.');
    const parts = candidate.content?.parts;
    if (!parts?.length || parts.some(part => part.functionCall)) throw new CleanupError('GEMINI_RESPONSE', 'Gemini returned an invalid cleanup result.');
    let result: unknown;
    try { result = JSON.parse(parts.filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('')); }
    catch { throw new CleanupError('GEMINI_RESPONSE', 'Gemini returned an invalid cleanup result. The original transcript is available.'); }
    if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).length !== 1 ||
        !('text' in result) || typeof result.text !== 'string' || result.text.length > Math.max(512, options.text.length * 2 + 256)) {
      throw new CleanupError('GEMINI_RESPONSE', 'Gemini returned an invalid cleanup result. The original transcript is available.');
    }
    return { text: normalizeDashes(result.text.trim()), model: options.model };
  } catch (error) {
    if (options.signal.aborted) throw new CleanupError('CANCELLED', 'Cleanup cancelled.', 499);
    if (timeout.aborted) throw new CleanupError('GEMINI_TIMEOUT', 'Gemini took too long. The original transcript is available.', 504);
    if (error instanceof CleanupError) throw error;
    throw new CleanupError('GEMINI_CONNECTION', 'Could not reach Gemini. The original transcript is available.');
  }
}

import { setTimeout as delay } from 'node:timers/promises';
import { MAX_CLEANUP_CHARS, OPENAI_CLEANUP_MODEL, type CleanupResult } from '../shared/cleanup';
import { normalizeDashes } from '../shared/lifecycle';
import type { SpeechLanguage } from '../shared/transcription';
import { cleanupInstructions } from './cleanup-prompt';
import { CleanupError, CLEANUP_MAX_ATTEMPTS, cleanupOutputLimit } from './cleanup-common';
import type { ProviderMeasure } from './timing';
export interface CleanupUsage { inputTokens: number; outputTokens: number; uncertainAttempts?: number; serviceTier?: CleanupResult['serviceTier'] }
async function readResponse(response: Response): Promise<any> {
  if (!response.body) throw new CleanupError('OPENAI_RESPONSE', 'The cleanup service returned an unreadable response.');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > 512 * 1024) { await reader.cancel(); throw new Error(); }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw new CleanupError('OPENAI_RESPONSE', 'The cleanup service returned an unreadable response. The original transcript is available.'); }
}
export async function cleanWithOpenAI(options: {
  apiKey: string; text: string; language: SpeechLanguage; signal: AbortSignal;
  fetcher?: typeof fetch; measure?: ProviderMeasure; onUsage?: (usage: CleanupUsage) => void;
}): Promise<CleanupResult> {
  if (!options.text.trim() || options.text.length > MAX_CLEANUP_CHARS) throw new CleanupError('CLEANUP_INPUT', 'This transcript is empty or exceeds the cleanup limit.', 400);
  const timeout = AbortSignal.timeout(20_000), signal = AbortSignal.any([timeout, options.signal]);
  const measure: ProviderMeasure = options.measure ?? ((_stage, work) => work());
  const body = JSON.stringify({
    model: OPENAI_CLEANUP_MODEL, service_tier: 'fast', reasoning: { effort: 'none' }, store: false,
    instructions: cleanupInstructions(options.language),
    input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify({ language: options.language, transcript: options.text }) }] }],
    max_output_tokens: cleanupOutputLimit(options.text),
    text: { format: { type: 'json_schema', name: 'dictation_cleanup', strict: true,
      schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } } }
  });
  try {
    let response: Response | undefined, uncertainAttempts = 0;
    for (let attempt = 0; attempt < CLEANUP_MAX_ATTEMPTS; attempt++) {
      signal.throwIfAborted();
      try {
        response = await measure('headers', () => (options.fetcher ?? fetch)('https://api.openai.com/v1/responses', {
          method: 'POST', redirect: 'error', signal, body,
          headers: { Authorization: 'Bearer ' + options.apiKey, 'Content-Type': 'application/json' }
        }));
      } catch (error) {
        if (signal.aborted || attempt + 1 === CLEANUP_MAX_ATTEMPTS) throw error;
        uncertainAttempts++; await delay(250, undefined, { signal }); continue;
      }
      if ([500, 502, 503, 504].includes(response.status) && attempt + 1 < CLEANUP_MAX_ATTEMPTS) {
        const header = response.headers.get('retry-after');
        const requested = header ? (/^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now()) : 250;
        const wait = Number.isFinite(requested) ? Math.max(250, requested) : 250;
        if (wait > 1000) break;
        void response.body?.cancel().catch(() => {}); uncertainAttempts++;
        await delay(wait, undefined, { signal }); continue;
      }
      break;
    }
    if (!response) throw new CleanupError('OPENAI_CONNECTION', 'Could not reach the cleanup service.');
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      if ([401, 403].includes(response.status)) throw new CleanupError('OPENAI_AUTH', 'OpenAI rejected backend access. Check the private API key and project permissions.', 503);
      if (response.status === 404) throw new CleanupError('OPENAI_MODEL', 'GPT-6 Luna is unavailable for this OpenAI project.', 503);
      if (response.status === 429) throw new CleanupError('OPENAI_QUOTA', 'OpenAI quota or rate limit reached. Check API credits and project limits.', 429);
      if (response.status === 400) throw new CleanupError('OPENAI_REQUEST', 'OpenAI rejected the cleanup request or Fast tier configuration. The original transcript is available.');
      throw new CleanupError('OPENAI_UNAVAILABLE', 'The cleanup service is temporarily unavailable. The original transcript is available.');
    }
    const data = await measure('body', () => readResponse(response!));
    const serviceTier: CleanupResult['serviceTier'] = ['fast', 'priority', 'default'].includes(data?.service_tier) ? data.service_tier : undefined;
    const usage = data?.usage;
    if (Number.isSafeInteger(usage?.input_tokens) && Number.isSafeInteger(usage?.output_tokens) && usage.input_tokens >= 0 && usage.output_tokens >= 0) {
      options.onUsage?.({ inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, ...(uncertainAttempts ? { uncertainAttempts } : {}), ...(serviceTier ? { serviceTier } : {}) });
    }
    if (data?.status !== 'completed' || data?.error || data?.incomplete_details) throw new CleanupError('OPENAI_INCOMPLETE', 'The cleanup service did not finish. The original transcript is available.');
    if (typeof data.model !== 'string' || !/^gpt-6-luna(?:-\d{4}-\d{2}-\d{2})?$/.test(data.model)) throw new CleanupError('OPENAI_MODEL', 'The cleanup service returned an unexpected model. The original transcript is available.');
    if (!Array.isArray(data.output)) throw new CleanupError('OPENAI_RESPONSE', 'The cleanup service returned an invalid result.');
    const messages = data.output.filter((item: any) => item?.type === 'message');
    if (messages.some((item: any) => Array.isArray(item.content) && item.content.some((part: any) => part?.type === 'refusal'))) throw new CleanupError('OPENAI_BLOCKED', 'The cleanup service could not process this transcript. The original is available.');
    if (messages.length !== 1 || messages[0].role !== 'assistant' || messages[0].status !== 'completed' || !Array.isArray(messages[0].content) ||
        data.output.some((item: any) => !['message', 'reasoning'].includes(item?.type)) || messages[0].content.some((part: any) => part?.type !== 'output_text' || typeof part.text !== 'string')) {
      throw new CleanupError('OPENAI_RESPONSE', 'The cleanup service returned an invalid result. The original transcript is available.');
    }
    let result: unknown;
    try { result = JSON.parse(messages[0].content.map((part: any) => part.text).join('')); }
    catch { throw new CleanupError('OPENAI_RESPONSE', 'The cleanup service returned an invalid result. The original transcript is available.'); }
    if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).length !== 1 || !('text' in result) || typeof result.text !== 'string' || result.text.length > Math.max(512, options.text.length * (options.language === 'multi' ? 4 : 2) + 256)) {
      throw new CleanupError('OPENAI_RESPONSE', 'The cleanup service returned an invalid result. The original transcript is available.');
    }
    return { text: normalizeDashes(result.text.trim()), model: OPENAI_CLEANUP_MODEL, ...(serviceTier ? { serviceTier } : {}) };
  } catch (error) {
    if (options.signal.aborted) throw new CleanupError('CANCELLED', 'Cleanup cancelled.', 499);
    if (timeout.aborted) throw new CleanupError('OPENAI_TIMEOUT', 'Text processing took too long. The original transcript is available.', 504);
    if (error instanceof CleanupError) throw error;
    throw new CleanupError('OPENAI_CONNECTION', 'Could not reach the cleanup service. The original transcript is available.');
  }
}

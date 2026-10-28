import { normalizeDashes } from '../shared/lifecycle';
import type { SpeechLanguage, Transcript } from '../shared/transcription';
import type { ProviderMeasure } from './timing';

export class SpeechError extends Error {
  constructor(public code: string, message: string, public status = 502) { super(message); }
}
async function boundedJSON(response: Response): Promise<unknown> {
  if (!response.body) throw new SpeechError('INVALID_RESPONSE', 'Deepgram returned an unreadable response.');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('Response limit'); }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw new SpeechError('INVALID_RESPONSE', 'Deepgram returned an unreadable response.'); }
}
export async function recognizeAudio(options: {
  apiKey: string; audio: Buffer; mimeType: string; language: SpeechLanguage;
  signal: AbortSignal; fetcher?: typeof fetch; measure?: ProviderMeasure;
}): Promise<Transcript> {
  const timeout = AbortSignal.timeout(60_000);
  const signal = AbortSignal.any([options.signal, timeout]);
  const url = new URL('https://api.deepgram.com/v1/listen');
  url.searchParams.set('model', 'nova-3'); url.searchParams.set('language', options.language);
  url.searchParams.set('smart_format', 'true'); url.searchParams.set('punctuate', 'true');
  url.searchParams.set('mip_opt_out', 'true');
  const measure: ProviderMeasure = options.measure ?? ((_stage, work) => work());
  try {
    const response = await measure('headers', () => (options.fetcher || fetch)(url, {
      method: 'POST', headers: { Authorization: 'Token ' + options.apiKey, 'Content-Type': options.mimeType },
      body: new Uint8Array(options.audio).buffer, signal, redirect: 'error'
    }));
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      if (response.status === 401 || response.status === 403) throw new SpeechError('PROVIDER_AUTH', 'Deepgram rejected the backend API key. Check the private .env file.', 503);
      if (response.status === 402) throw new SpeechError('PROVIDER_CREDITS', 'Deepgram could not process the request. Check the account balance and billing.', 503);
      if (response.status === 429) throw new SpeechError('PROVIDER_RATE_LIMIT', 'Deepgram is limiting requests. Wait before trying again.', 429);
      if (response.status === 400 || response.status === 415 || response.status === 422) throw new SpeechError('AUDIO_REJECTED', 'Deepgram could not read this audio. Try a new recording.', 422);
      throw new SpeechError('PROVIDER_UNAVAILABLE', 'Deepgram is temporarily unavailable. Keep the clip and try again later.');
    }
    const data = await measure('body', () => boundedJSON(response)) as { results?: { channels?: { alternatives?: { transcript?: unknown; confidence?: unknown }[] }[] }; metadata?: { duration?: unknown } };
    const alternative = data?.results?.channels?.[0]?.alternatives?.[0];
    if (!alternative || typeof alternative.transcript !== 'string' || alternative.transcript.length > 100_000) throw new SpeechError('INVALID_RESPONSE', 'Deepgram returned an unreadable transcript.');
    const duration = data.metadata?.duration;
    const confidence = alternative.confidence;
    return {
      text: normalizeDashes(alternative.transcript.trim()), language: options.language, model: 'nova-3',
      durationMs: typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 ? Math.round(duration * 1000) : 0,
      confidence: typeof confidence === 'number' && confidence >= 0 && confidence <= 1 ? confidence : null
    };
  } catch (error) {
    if (options.signal.aborted) throw new SpeechError('CANCELLED', 'Transcription cancelled.', 499);
    if (timeout.aborted) throw new SpeechError('PROVIDER_TIMEOUT', 'Deepgram took too long. The clip is still available for a manual retry.', 504);
    if (error instanceof SpeechError) throw error;
    throw new SpeechError('PROVIDER_CONNECTION', 'Could not reach Deepgram. Check the internet connection and try again.');
  }
}

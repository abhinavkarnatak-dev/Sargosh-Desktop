import { describe, expect, it, vi } from 'vitest';
import { recognizeAudio, SpeechError } from '../src/server/deepgram';

const providerData = (text = 'Tuesday\u2014sorry\u2013Thursday.') => ({
  results: { channels: [{ alternatives: [{ transcript: text, confidence: .95 }] }] }, metadata: { duration: 2.5 }
});
const args = () => ({ apiKey: 'server-only-fixture-token', audio: Buffer.from('audio'), mimeType: 'audio/webm', language: 'en' as const, signal: new AbortController().signal });
describe('Deepgram REST adapter', () => {
  it('sends container audio with a backend-only key and opts out of model improvement', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(providerData())));
    const result = await recognizeAudio({ ...args(), fetcher });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toContain('https://api.deepgram.com/v1/listen?');
    expect(String(url)).toContain('model=nova-3'); expect(String(url)).toContain('mip_opt_out=true');
    expect(String(url)).not.toContain('encoding='); expect(String(url)).not.toContain('sample_rate=');
    expect(init?.headers).toEqual({ Authorization: 'Token server-only-fixture-token', 'Content-Type': 'audio/webm' });
    expect(Buffer.from(init!.body as ArrayBuffer).toString()).toBe('audio');
    expect(result).toEqual({ text: 'Tuesday-sorry-Thursday.', language: 'en', model: 'nova-3', durationMs: 2500, confidence: .95 });
    expect(JSON.stringify(result)).not.toContain('fixture-token');
  });
  it('accepts an empty transcript as a no-speech result', async () => {
    const result = await recognizeAudio({ ...args(), fetcher: async () => new Response(JSON.stringify(providerData(''))) });
    expect(result.text).toBe('');
  });
  it.each([[401, 'PROVIDER_AUTH', 503], [403, 'PROVIDER_AUTH', 503], [402, 'PROVIDER_CREDITS', 503], [429, 'PROVIDER_RATE_LIMIT', 429], [400, 'AUDIO_REJECTED', 422], [503, 'PROVIDER_UNAVAILABLE', 502]])('sanitizes provider status %i without returning the raw response', async (status, code, expectedStatus) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('secret provider body', { status: status as number }));
    try { await recognizeAudio({ ...args(), fetcher }); throw new Error('Expected failure'); }
    catch (error) { expect(error).toBeInstanceOf(SpeechError); expect(error).toMatchObject({ code, status: expectedStatus }); expect((error as Error).message).not.toContain('secret'); }
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('does not return arbitrary connection error details', async () => {
    await expect(recognizeAudio({ ...args(), fetcher: async () => { throw new Error('Authorization: secret'); } })).rejects.toMatchObject({ code: 'PROVIDER_CONNECTION' });
  });
  it('rejects malformed provider responses', async () => {
    for (const body of ['not json', '{}', '{"results":{"channels":[]}}']) {
      await expect(recognizeAudio({ ...args(), fetcher: async () => new Response(body) })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });
  it('propagates cancellation without retrying the paid request', async () => {
    const abort = new AbortController();
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    }));
    const pending = recognizeAudio({ ...args(), signal: abort.signal, fetcher }); abort.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' }); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('reports a provider timeout distinctly', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
    try {
      await expect(recognizeAudio({ ...args(), fetcher: async () => { throw new Error('Timeout'); } })).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT', status: 504 });
    } finally { timeout.mockRestore(); }
  });
  it('bounds the size of the provider response', async () => {
    await expect(recognizeAudio({ ...args(), fetcher: async () => new Response('x'.repeat(4 * 1024 * 1024 + 1)) })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

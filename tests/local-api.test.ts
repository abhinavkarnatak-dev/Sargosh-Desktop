import { describe, expect, it, vi } from 'vitest';
import { createServer } from '../src/server/app';
import { transcribeViaLocalAPI } from '../src/shared/local-api';
const result = { results: { channels: [{ alternatives: [{ transcript: 'Integrated transcript.', confidence: .8 }] }] }, metadata: { duration: 1.25 } };
describe('recording audio to local API transport', () => {
  it('bootstraps a local token, uploads real bytes, and parses the provider result', async () => {
    const provider = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(result)));
    const server = createServer({ localMode: true, apiKey: 'server-only-fixture-token', fetcher: provider });
    const requests: string[] = [];
    const browserFetch: typeof fetch = async (input, init) => {
      const url = String(input).replace(/^\/api/, '');
      requests.push(url);
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      const reply = await server.inject({ method: init?.method === 'POST' ? 'POST' : 'GET', url, headers: { ...headers, host: '127.0.0.1:4318' }, payload: init?.body ? Buffer.from(init.body as ArrayBuffer) : undefined });
      return new Response(reply.body, { status: reply.statusCode, headers: { 'content-type': 'application/json' } });
    };
    try {
      const audio = new TextEncoder().encode('recorded container bytes').buffer;
      const transcript = await transcribeViaLocalAPI({ requestId: 'request-1', audio, mimeType: 'audio/webm;codecs=opus', language: 'multi' }, new AbortController().signal, '/api', browserFetch);
      expect(requests).toEqual(['/v1/local-session', '/v1/transcriptions?language=multi']);
      expect(transcript).toEqual({ text: 'Integrated transcript.', language: 'multi', model: 'nova-3', durationMs: 1250, confidence: .8 });
      expect(Buffer.from(provider.mock.calls[0][1]!.body as ArrayBuffer).toString()).toBe('recorded container bytes');
    } finally { await server.close(); }
  });
  it('stops after a missing-key response without attempting an audio upload', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ code: 'NOT_CONFIGURED', message: 'Configure the key.' }), { status: 503 }));
    await expect(transcribeViaLocalAPI({ requestId: 'one', audio: new Uint8Array([1]).buffer, mimeType: 'audio/webm', language: 'en' }, new AbortController().signal, '/api', fetcher)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('does not expose raw network errors', async () => {
    const fetcher: typeof fetch = async () => { throw new Error('sensitive diagnostics'); };
    await expect(transcribeViaLocalAPI({ requestId: 'one', audio: new Uint8Array([1]).buffer, mimeType: 'audio/webm', language: 'en' }, new AbortController().signal, '/api', fetcher)).rejects.toMatchObject({ code: 'LOCAL_CONNECTION', message: 'Could not reach the local transcription API. Check that it is running.' });
  });
});

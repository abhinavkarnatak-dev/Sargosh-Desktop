import Fastify from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { MAX_AUDIO_BYTES } from '../shared/recording';
import { audioType, isRequestId, isSpeechLanguage, type Transcript } from '../shared/transcription';
import { recognizeAudio, SpeechError } from './deepgram';

interface ServerOptions { apiKey?: string; localMode?: boolean; fetcher?: typeof fetch }
export function createServer(options: ServerOptions = {}) {
  const server = Fastify({ logger: false, bodyLimit: MAX_AUDIO_BYTES, requestTimeout: 90_000 });
  const token = randomBytes(32).toString('hex');
  const configured = options.localMode === true && Boolean(options.apiKey);
  let active = false;
  const completed = new Map<string, { time: number; fingerprint: string; result: Transcript }>();
  const attempts: number[] = [];
  const validToken = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && timingSafeEqual(Buffer.from(value), Buffer.from(token));
  server.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    // This development bridge is loopback-only, not a replacement for user authentication.
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip) ||
        !/^127\.0\.0\.1:(4318|5173)$/.test(request.headers.host || '') ||
        (request.headers.origin && request.headers.origin !== 'http://127.0.0.1:5173')) {
      return reply.code(403).send({ code: 'LOCAL_ONLY', message: 'This API is available only to the local development app.' });
    }
  });
  server.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    const status = error.statusCode || 500;
    reply.code(status >= 400 && status < 500 ? status : 500).send({
      code: status === 413 ? 'AUDIO_TOO_LARGE' : 'INVALID_REQUEST',
      message: status === 413 ? 'Audio exceeds the 25 MiB limit.' : 'The transcription request could not be processed.'
    });
  });
  server.addContentTypeParser(/^audio\/(webm|ogg|wav|mpeg|mp4)(?:\s*;.*)?$/i, { parseAs: 'buffer', bodyLimit: MAX_AUDIO_BYTES }, (_request, body, done) => done(null, body));
  server.get('/health', async () => ({ status: 'ok', service: 'sargosh-api', version: '0.1.0' }));
  server.get('/v1/readiness', async () => ({ auth: false, stt: configured, cleanup: false }));
  server.get('/v1/local-session', async (_request, reply) => {
    if (!configured) return reply.code(503).send({ code: 'NOT_CONFIGURED', message: 'Enable local transcription and configure the backend Deepgram key first.' });
    return { token };
  });
  server.post('/v1/transcriptions', {
    onRequest: async (request, reply) => {
      if (!configured) return reply.code(503).send({ code: 'NOT_CONFIGURED', message: 'Cloud transcription is not configured for local development.' });
      if (!validToken(request.headers['x-sargosh-token'])) return reply.code(401).send({ code: 'LOCAL_SESSION', message: 'The local API session expired. Try again.' });
    }
  }, async (request, reply) => {
    const language = (request.query as { language?: unknown })?.language;
    const requestId = request.headers['x-sargosh-request-id'];
    const mimeType = typeof request.headers['content-type'] === 'string' ? audioType(request.headers['content-type']) : null;
    if (!mimeType || !Buffer.isBuffer(request.body)) return reply.code(415).send({ code: 'AUDIO_TYPE', message: 'Send a supported audio recording.' });
    if (!isSpeechLanguage(language) || !isRequestId(requestId) || !request.body.length) return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'A non-empty recording, supported language, and request ID are required.' });
    const now = Date.now();
    for (const [id, item] of completed) if (now - item.time > 5 * 60_000) completed.delete(id);
    const fingerprint = createHash('sha256').update(language).update(mimeType).update(request.body).digest('hex');
    const previous = completed.get(requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) return reply.code(409).send({ code: 'REQUEST_ID_REUSED', message: 'Use a new request ID for a different recording.' });
      return previous.result;
    }
    if (active) return reply.code(429).send({ code: 'BUSY', message: 'One transcription is already running. Wait for it to finish.' });
    while (attempts.length && now - attempts[0] > 60_000) attempts.shift();
    if (attempts.length >= 10) return reply.code(429).send({ code: 'LOCAL_RATE_LIMIT', message: 'The local test limit is 10 transcription attempts per minute.' });
    attempts.push(now); active = true;
    const abort = new AbortController();
    const disconnect = () => { if (!reply.raw.writableEnded) abort.abort(); };
    request.raw.once('aborted', disconnect); reply.raw.once('close', disconnect);
    try {
      const result = await recognizeAudio({ apiKey: options.apiKey!, audio: request.body, mimeType, language, signal: abort.signal, fetcher: options.fetcher });
      if (completed.size >= 32) completed.delete(completed.keys().next().value!);
      completed.set(requestId, { time: Date.now(), fingerprint, result }); return result;
    } catch (error) {
      const failure = error instanceof SpeechError ? error : new SpeechError('TRANSCRIPTION_FAILED', 'Transcription failed. Try again later.');
      return reply.code(failure.status).send({ code: failure.code, message: failure.message });
    } finally {
      active = false; request.raw.removeListener('aborted', disconnect); reply.raw.removeListener('close', disconnect);
    }
  });
  return server;
}

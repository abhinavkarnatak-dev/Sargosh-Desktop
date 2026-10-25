import { sessionVerifier } from './auth';
import Fastify from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { MAX_AUDIO_BYTES } from '../shared/recording';
import { audioType, isRequestId, isSpeechLanguage, type Transcript } from '../shared/transcription';
import { DEFAULT_CLEANUP_MODEL, MAX_CLEANUP_CHARS, type CleanupModel, type CleanupResult } from '../shared/cleanup';
import { CLEANUP_PROMPT_VERSION } from './cleanup-prompt';
import { cleanTranscript, CleanupError } from './gemini';
import { recognizeAudio, SpeechError } from './deepgram';

interface ServerOptions { authConfig?: { url: string; key: string }; verifySession?: (token: string) => Promise<string | null>; apiKey?: string; localMode?: boolean; fetcher?: typeof fetch; geminiApiKey?: string; geminiModel?: CleanupModel; geminiFetcher?: typeof fetch }
export function createServer(options: ServerOptions = {}) {
  const server = Fastify({ logger: false, bodyLimit: MAX_AUDIO_BYTES, requestTimeout: 90_000 });
  const verifySession = options.verifySession ?? (options.authConfig ? sessionVerifier(options.authConfig) : undefined);
  const userIds = new WeakMap<object, string>();
  const token = randomBytes(32).toString('hex');
  const configured = options.localMode === true && Boolean(options.apiKey);
  const cleanupConfigured = options.localMode === true && Boolean(options.geminiApiKey);
  let active = false;
  const cleanupCache = new Map<string, { time: number; fingerprint: string; result: CleanupResult }>();
  const cleanupAttempts: number[] = [];
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
      code: status === 413 ? (_request.url.startsWith('/v1/cleanup') ? 'TEXT_TOO_LARGE' : 'AUDIO_TOO_LARGE') : 'INVALID_REQUEST',
      message: status === 413 ? (_request.url.startsWith('/v1/cleanup') ? 'Transcript exceeds the cleanup size limit.' : 'Audio exceeds the 25 MiB limit.') : 'The transcription request could not be processed.'
    });
  });
  server.addContentTypeParser(/^audio\/(webm|ogg|wav|mpeg|mp4)(?:\s*;.*)?$/i, { parseAs: 'buffer', bodyLimit: MAX_AUDIO_BYTES }, (_request, body, done) => done(null, body));
  server.get('/health', async () => ({ status: 'ok', service: 'sargosh-api', version: '0.1.0' }));
  server.get('/v1/readiness', async () => ({ auth: Boolean(verifySession), stt: configured, cleanup: cleanupConfigured }));
  server.get('/v1/local-session', async (_request, reply) => {
    if (!configured && !cleanupConfigured) return reply.code(503).send({ code: 'NOT_CONFIGURED', message: 'Enable local transcription and configure the backend Deepgram key first.' });
    return { token };
  });
  server.post('/v1/transcriptions', {
    onRequest: async (request, reply) => {
      if (!configured) return reply.code(503).send({ code: 'NOT_CONFIGURED', message: 'Cloud transcription is not configured for local development.' });
      if (!validToken(request.headers['x-sargosh-token'])) return reply.code(401).send({ code: 'LOCAL_SESSION', message: 'The local API session expired. Try again.' });
      if (verifySession) {
        const authorization = request.headers.authorization;
        const accessToken = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
        const userId = accessToken ? await verifySession(accessToken).catch(() => null) : null;
        if (!userId) return reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Sign in again to use cloud dictation.' });
        userIds.set(request, userId);
      }
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
    const cacheId = (userIds.get(request) ?? 'local') + ':' + requestId;
    const previous = completed.get(cacheId);
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
      completed.set(cacheId, { time: Date.now(), fingerprint, result }); return result;
    } catch (error) {
      const failure = error instanceof SpeechError ? error : new SpeechError('TRANSCRIPTION_FAILED', 'Transcription failed. Try again later.');
      return reply.code(failure.status).send({ code: failure.code, message: failure.message });
    } finally {
      active = false; request.raw.removeListener('aborted', disconnect); reply.raw.removeListener('close', disconnect);
    }
  });
  server.post('/v1/cleanup', {
    bodyLimit: 128 * 1024,
    onRequest: async (request, reply) => {
      if (!cleanupConfigured) return reply.code(503).send({ code: 'CLEANUP_NOT_CONFIGURED', message: 'Configure GEMINI_API_KEY in the private backend .env. The original transcript is available.' });
      if (!validToken(request.headers['x-sargosh-token'])) return reply.code(401).send({ code: 'LOCAL_SESSION', message: 'The local API session expired. Try again.' });
      if (verifySession) {
        const authorization = request.headers.authorization;
        const accessToken = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
        const userId = accessToken ? await verifySession(accessToken).catch(() => null) : null;
        if (!userId) return reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Sign in again to use cloud dictation.' });
        userIds.set(request, userId);
      }
    }
  }, async (request, reply) => {
    const body = request.body as { text?: unknown; language?: unknown } | null;
    const requestId = request.headers['x-sargosh-request-id'];
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['text', 'language'].includes(key)) ||
        typeof body.text !== 'string' || !body.text.trim() || body.text.length > MAX_CLEANUP_CHARS || !isSpeechLanguage(body.language) || !isRequestId(requestId)) {
      return reply.code(400).send({ code: 'CLEANUP_INPUT', message: 'A non-empty transcript within the cleanup limit, supported language, and request ID are required.' });
    }
    const model = options.geminiModel || DEFAULT_CLEANUP_MODEL;
    const fingerprint = createHash('sha256').update(CLEANUP_PROMPT_VERSION).update(model).update(body.language).update(body.text).digest('hex');
    const now = Date.now();
    for (const [id, item] of cleanupCache) if (now - item.time > 5 * 60_000) cleanupCache.delete(id);
    const cacheId = (userIds.get(request) ?? 'local') + ':' + requestId;
    const previous = cleanupCache.get(cacheId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) return reply.code(409).send({ code: 'REQUEST_ID_REUSED', message: 'Use a new request ID for a different cleanup.' });
      return previous.result;
    }
    if (active) return reply.code(429).send({ code: 'BUSY', message: 'A cloud request is already running. Wait for it to finish.' });
    while (cleanupAttempts.length && now - cleanupAttempts[0] > 60_000) cleanupAttempts.shift();
    if (cleanupAttempts.length >= 10) return reply.code(429).send({ code: 'LOCAL_RATE_LIMIT', message: 'The local test limit is 10 cleanup attempts per minute.' });
    cleanupAttempts.push(now); active = true;
    const abort = new AbortController();
    const disconnect = () => { if (!reply.raw.writableEnded) abort.abort(); };
    request.raw.once('aborted', disconnect); reply.raw.once('close', disconnect);
    try {
      const result = await cleanTranscript({ apiKey: options.geminiApiKey!, model, text: body.text, language: body.language, signal: abort.signal, fetcher: options.geminiFetcher });
      if (cleanupCache.size >= 32) cleanupCache.delete(cleanupCache.keys().next().value!);
      cleanupCache.set(cacheId, { time: Date.now(), fingerprint, result }); return result;
    } catch (error) {
      const failure = error instanceof CleanupError ? error : new CleanupError('CLEANUP_FAILED', 'Cleanup failed. The original transcript is available.');
      return reply.code(failure.status).send({ code: failure.code, message: failure.message });
    } finally {
      active = false; request.raw.removeListener('aborted', disconnect); reply.raw.removeListener('close', disconnect);
    }
  });
  return server;
}

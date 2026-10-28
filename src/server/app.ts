import { installStreaming } from './streaming';
import { UsageError } from './usage';
import { createCleanupProvider } from './cleanup-provider';
import { createHostedServer,type HostedOptions } from './hosted';
import { installTimingHooks, timeRequest, markCached, cancelRequestTiming, providerTiming } from './timing';
import { sessionVerifier } from './auth';
import Fastify from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { MAX_AUDIO_BYTES } from '../shared/recording';
import { audioType, isRequestId, isSpeechLanguage, type Transcript } from '../shared/transcription';
import { MAX_CLEANUP_CHARS, type CleanupResult } from '../shared/cleanup';
import { CLEANUP_PROMPT_VERSION } from './cleanup-prompt';
import { CleanupError } from './cleanup-common';
import { recognizeAudio, SpeechError } from './deepgram';

interface ServerOptions extends HostedOptions { hostedMode?: boolean; localMode?: boolean }
export function createServer(options: ServerOptions = {}) {
  if(options.hostedMode) return createHostedServer(options);
  const server = Fastify({ logger: false, bodyLimit: MAX_AUDIO_BYTES, requestTimeout: 90_000 });
  installTimingHooks(server, options.timingSink);
  const verifySession = options.verifySession ?? (options.authConfig ? sessionVerifier(options.authConfig) : undefined);
  const userIds = new WeakMap<object, string>();
  const token = randomBytes(32).toString('hex');
  const configured = options.localMode === true && Boolean(options.apiKey);
  const cleanup = createCleanupProvider(options);
  const cleanupConfigured = options.localMode === true && cleanup.configured;
  installStreaming(server, { ...options, enabled: options.localMode === true && options.streamingEnabled !== false, rate: options.streamRateMicroPerMinute,
    authorize: async (headers,ip) => {
      if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip) || headers.host !== '127.0.0.1:4318' || headers.origin || !validToken(headers['x-sargosh-token'])) throw new UsageError('LOCAL_SESSION','The local live session expired.',401);
      if (!verifySession) return 'local';
      const h=headers.authorization; const owner=typeof h==='string' && h.startsWith('Bearer ')?await verifySession(h.slice(7)).catch(()=>null):null;
      if(!owner)throw new UsageError('AUTH_REQUIRED','Sign in again to use live dictation.',401);return owner;
    }
  });
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
  for (const route of ['/v1/transcriptions', '/v1/dictations']) server.post(route, {
    onRequest: async (request, reply) => {
      if (!configured) return reply.code(503).send({ code: 'NOT_CONFIGURED', message: 'Cloud transcription is not configured for local development.' });
      if (!validToken(request.headers['x-sargosh-token'])) return reply.code(401).send({ code: 'LOCAL_SESSION', message: 'The local API session expired. Try again.' });
      if (verifySession) {
        const authorization = request.headers.authorization;
        const accessToken = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
        const userId = accessToken ? await timeRequest(request, 'server.auth', () => verifySession(accessToken).catch(() => null)) : null;
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
    const fingerprint = createHash('sha256').update(route === '/v1/dictations' ? CLEANUP_PROMPT_VERSION + cleanup.fingerprint : '').update(language).update(mimeType).update(request.body).digest('hex');
    const cacheId = (userIds.get(request) ?? 'local') + ':' + route + ':' + requestId;
    const previous = completed.get(cacheId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) return reply.code(409).send({ code: 'REQUEST_ID_REUSED', message: 'Use a new request ID for a different recording.' });
      markCached(request); return previous.result;
    }
    if (active) return reply.code(429).send({ code: 'BUSY', message: 'One transcription is already running. Wait for it to finish.' });
    while (attempts.length && now - attempts[0] > 60_000) attempts.shift();
    if (attempts.length >= 10) return reply.code(429).send({ code: 'LOCAL_RATE_LIMIT', message: 'The local test limit is 10 transcription attempts per minute.' });
    attempts.push(now); active = true;
    const abort = new AbortController();
    const disconnect = () => { if (!reply.raw.writableEnded) { cancelRequestTiming(request); abort.abort(); } };
    request.raw.once('aborted', disconnect); reply.raw.once('close', disconnect);
    try {
      const audio = request.body;
      const result = await timeRequest(request, 'server.stt', () => recognizeAudio({ apiKey: options.apiKey!, audio, mimeType, language, signal: abort.signal, fetcher: options.fetcher, measure: providerTiming(request, 'stt') }), { bytes: audio.length, model: 'nova-3' }, abort.signal);
      if (route === '/v1/dictations' && result.text.trim()) {
        try {
          if (!cleanupConfigured) throw new CleanupError('CLEANUP_NOT_CONFIGURED', 'Cleanup is not configured. The original transcript is available.', 503);
          const model = cleanup.model;
          const clean = await timeRequest(request, 'server.cleanup', () => cleanup.clean({ text: result.text, language, signal: abort.signal, measure: providerTiming(request, 'cleanup') }), { characters: result.text.length, model }, abort.signal);
          result.cleanup = { ok: true, result: clean };
        } catch (error) {
          const failure = error instanceof CleanupError ? error : new CleanupError('CLEANUP_FAILED', 'Cleanup failed. The original transcript is available.');
          result.cleanup = { ok: false, code: failure.code, message: failure.message };
        }
      }
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
      if (!cleanupConfigured) return reply.code(503).send({ code: 'CLEANUP_NOT_CONFIGURED', message: 'Configure the selected cleanup provider key in the private backend .env. The original transcript is available.' });
      if (!validToken(request.headers['x-sargosh-token'])) return reply.code(401).send({ code: 'LOCAL_SESSION', message: 'The local API session expired. Try again.' });
      if (verifySession) {
        const authorization = request.headers.authorization;
        const accessToken = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
        const userId = accessToken ? await timeRequest(request, 'server.auth', () => verifySession(accessToken).catch(() => null)) : null;
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
    const model = cleanup.model;
    const fingerprint = createHash('sha256').update(CLEANUP_PROMPT_VERSION).update(cleanup.fingerprint).update(body.language).update(body.text).digest('hex');
    const now = Date.now();
    for (const [id, item] of cleanupCache) if (now - item.time > 5 * 60_000) cleanupCache.delete(id);
    const cacheId = (userIds.get(request) ?? 'local') + ':' + requestId;
    const previous = cleanupCache.get(cacheId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) return reply.code(409).send({ code: 'REQUEST_ID_REUSED', message: 'Use a new request ID for a different cleanup.' });
      markCached(request); return previous.result;
    }
    if (active) return reply.code(429).send({ code: 'BUSY', message: 'A cloud request is already running. Wait for it to finish.' });
    while (cleanupAttempts.length && now - cleanupAttempts[0] > 60_000) cleanupAttempts.shift();
    if (cleanupAttempts.length >= 10) return reply.code(429).send({ code: 'LOCAL_RATE_LIMIT', message: 'The local test limit is 10 cleanup attempts per minute.' });
    cleanupAttempts.push(now); active = true;
    const abort = new AbortController();
    const disconnect = () => { if (!reply.raw.writableEnded) { cancelRequestTiming(request); abort.abort(); } };
    request.raw.once('aborted', disconnect); reply.raw.once('close', disconnect);
    try {
      const text = body.text, language = body.language;
      const result = await timeRequest(request, 'server.cleanup', () => cleanup.clean({ text, language, signal: abort.signal, measure: providerTiming(request, 'cleanup') }), { characters: text.length, model }, abort.signal);
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

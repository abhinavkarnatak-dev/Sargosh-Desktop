// Content-free diagnostics. Keep this module usable in Electron, browsers and Node.
import { CLEANUP_MODELS, type CleanupModel } from './cleanup';
export const TIMING_STAGES = [
  'stream.handshake', 'stream.connect', 'stream.finalize', 'stream.transport', 'stream.open',
  'dictation.http', 'dictation.transport', 'server.dictation.total', 'recording.open', 'recording.finish', 'history.save', 'stt.transport', 'cleanup.transport',
  'audio.serialize', 'auth.token', 'stt.session', 'cleanup.session', 'stt.http', 'cleanup.http',
  'server.stt.total', 'server.cleanup.total', 'server.auth', 'server.eligibility', 'server.normalize',
  'server.reserve', 'server.dispatch', 'server.stt', 'server.cleanup', 'server.finish', 'server.release', 'server.body',
  'provider.stt.headers', 'provider.stt.body', 'provider.cleanup.headers', 'provider.cleanup.body',
  'delivery.total', 'delivery.first_input_ack', 'delivery.path', 'dictation.stop_to_complete', 'dictation.stop_to_first_input_ack',
] as const;
export type TimingStage = typeof TIMING_STAGES[number];
export type TimingOutcome = 'ok' | 'failed' | 'cancelled' | 'skipped';
export const TIMING_ERROR_CODES = ['STREAM_FAILED', 'STREAM_LIMIT', 'STREAM_TIMEOUT', 'STREAM_PROTOCOL', 'STREAM_CONNECTION', 'PROVIDER_CONNECTION', 'PROVIDER_TIMEOUT','OPENAI_AUTH', 'OPENAI_MODEL', 'OPENAI_QUOTA', 'OPENAI_REQUEST', 'OPENAI_UNAVAILABLE', 'OPENAI_TIMEOUT', 'OPENAI_CONNECTION', 'OPENAI_BLOCKED', 'OPENAI_INCOMPLETE', 'OPENAI_RESPONSE', 'CLEANUP_INPUT', 'CLEANUP_FAILED', 'CLEANUP_NOT_CONFIGURED', 'SERVICE_BUDGET', 'USAGE_UNAVAILABLE', 'PRACTICE_UNAVAILABLE', 'REQUEST_PENDING', 'GEMINI_TIMEOUT', 'GEMINI_QUOTA', 'GEMINI_AUTH', 'GEMINI_MODEL', 'GEMINI_REQUEST', 'GEMINI_UNAVAILABLE', 'GEMINI_CONNECTION', 'GEMINI_BLOCKED', 'GEMINI_INCOMPLETE', 'GEMINI_RESPONSE', 'CANCELLED', 'BUSY', 'SERVICE_BUSY', 'LOCAL_API', 'target-unavailable', 'delivery-already-attempted', 'target-stale', 'target-protected', 'focus-denied', 'focus-changed', 'modifiers-held', 'layout-changed', 'paste-unconfirmed', 'native-error'] as const;
export const timingErrorCode = (value: unknown) => TIMING_ERROR_CODES.find(code => code === value);
export interface TimingMeta {
  networkError?: typeof NETWORK_ERRORS[number];
  handshakeFailure?: typeof HANDSHAKE_FAILURES[number];
  closeCode?: number;
  serviceTier?: 'fast' | 'priority' | 'default';
  errorCode?: typeof TIMING_ERROR_CODES[number];
  method?: 'paste' | 'keyboard';
  fallbackReason?: 'clipboard-window' | 'clipboard-busy' | 'clipboard-format' | 'clipboard-memory' | 'clipboard-prepare' | 'clipboard-changed';
  clipboardFormat?: number; windowsError?: number;
  model?: 'nova-3' | CleanupModel;
  bytes?: number; characters?: number; audioMs?: number; statusCode?: number; cached?: boolean; practice?: boolean;
}
export const NETWORK_ERRORS = ['EACCES', 'EPERM', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE', 'EPROTO', 'ERR_OSSL_EVP_UNSUPPORTED', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID'] as const;
export const HANDSHAKE_FAILURES = ['http-rejected', 'socket-error', 'socket-closed', 'socket-destroyed', 'upgrade-exception', 'upgrade-rejected', 'invalid-upgrade-header', 'invalid-accept-header', 'invalid-subprotocol', 'invalid-extensions'] as const;
export interface TimingEvent extends TimingMeta {
  event: 'sargosh.timing'; schemaVersion: 1; traceId: string; requestId?: string;
  scope: 'desktop' | 'client' | 'server'; stage: TimingStage; durationMs: number; outcome: TimingOutcome;
}
export type TimingSink = (event: TimingEvent) => void;
export const timingId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(value);
const outcomes = ['ok', 'failed', 'cancelled', 'skipped'];
// Explicit allowlist: never serialize arbitrary request data, exceptions, prompts or tokens.
export function safeTiming(value: unknown): TimingEvent | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as TimingEvent;
  if (input.event !== 'sargosh.timing' || input.schemaVersion !== 1 || !timingId(input.traceId) ||
      (input.requestId !== undefined && !timingId(input.requestId)) ||
      !['desktop', 'client', 'server'].includes(input.scope) || !TIMING_STAGES.includes(input.stage) ||
      !outcomes.includes(input.outcome) || !Number.isFinite(input.durationMs) || input.durationMs < 0 || input.durationMs > 86_400_000) return null;
  const event: TimingEvent = { event: input.event, schemaVersion: 1, traceId: input.traceId,
    ...(input.requestId ? { requestId: input.requestId } : {}), scope: input.scope, stage: input.stage,
    durationMs: Math.round(input.durationMs * 100) / 100, outcome: input.outcome };
  for (const key of ['bytes', 'characters', 'audioMs', 'statusCode', 'clipboardFormat', 'windowsError', 'closeCode'] as const) {
    const number = input[key];
    if (typeof number === 'number' && Number.isFinite(number) && number >= 0) event[key] = number;
  }
  for (const key of ['cached', 'practice'] as const) if (typeof input[key] === 'boolean') event[key] = input[key];
  if (input.model === 'nova-3' || CLEANUP_MODELS.some(model => model === input.model)) event.model = input.model;
  if (input.method === 'paste' || input.method === 'keyboard') event.method = input.method;
  if (input.fallbackReason && ['clipboard-window', 'clipboard-busy', 'clipboard-format', 'clipboard-memory', 'clipboard-prepare', 'clipboard-changed'].includes(input.fallbackReason)) event.fallbackReason = input.fallbackReason;
  if (TIMING_ERROR_CODES.some(code => code === input.errorCode)) event.errorCode = input.errorCode;
  if (NETWORK_ERRORS.some(code => code === input.networkError)) event.networkError = input.networkError;
  if (HANDSHAKE_FAILURES.some(code => code === input.handshakeFailure)) event.handshakeFailure = input.handshakeFailure;
  if (['fast', 'priority', 'default'].includes(input.serviceTier ?? '')) event.serviceTier = input.serviceTier;
  return event;
}
let sink: TimingSink = event => console.info(JSON.stringify(event));
export function setTimingSink(value: TimingSink) { sink = value; }
export function emitTiming(event: TimingEvent, output: TimingSink = sink) {
  const safe = safeTiming(event);
  if (safe) { try { output(safe); } catch { /* Diagnostics must not break dictation. */ } }
}
export class TimingTrace {
  constructor(readonly traceId: string, readonly scope: TimingEvent['scope'], readonly requestId?: string,
    private output?: TimingSink, private now = () => performance.now()) {}
  span(stage: TimingStage, meta: TimingMeta = {}, signal?: AbortSignal) {
    const start = this.now(); let ended = false;
    const end = (outcome: TimingOutcome = 'ok', extra: TimingMeta = {}) => {
      if (ended) return;
      ended = true; signal?.removeEventListener('abort', cancelled);
      emitTiming({ event: 'sargosh.timing', schemaVersion: 1, traceId: this.traceId, requestId: this.requestId,
        scope: this.scope, stage, durationMs: Math.max(0, this.now() - start), outcome, ...meta, ...extra }, this.output);
    };
    const cancelled = () => end('cancelled');
    if (signal?.aborted) cancelled(); else signal?.addEventListener('abort', cancelled, { once: true });
    return { end };
  }
  async measure<T>(stage: TimingStage, work: () => Promise<T>, meta: TimingMeta = {}, signal?: AbortSignal): Promise<T> {
    const span = this.span(stage, meta, signal);
    try { const result = await work(); span.end(signal?.aborted ? 'cancelled' : 'ok'); return result; }
    catch (error) { span.end(signal?.aborted ? 'cancelled' : 'failed', { errorCode: (error as { code?: TimingMeta['errorCode'] } | null)?.code }); throw error; }
  }
}

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { TimingTrace, timingId, type TimingSink, type TimingStage, type TimingMeta } from '../shared/timing';

const traces = new WeakMap<object, TimingTrace>();
const cached = new WeakMap<object, boolean>();
const totals = new WeakMap<object, ReturnType<TimingTrace['span']>>();
const bodies = new WeakMap<object, ReturnType<TimingTrace['span']>>();
export function markCached(request: FastifyRequest) { cached.set(request, true); }
export function cancelRequestTiming(request: FastifyRequest) {
  bodies.get(request)?.end('cancelled'); totals.get(request)?.end('cancelled');
}
export function installTimingHooks(server: FastifyInstance, sink?: TimingSink) {
  server.addHook('onRequest', async request => {
    const path = request.url.split('?')[0];
    if (!/^\/v1\/(practice\/)?(transcriptions|cleanup|dictations)$/.test(path)) return;
    const id = request.headers['x-sargosh-trace-id']; const requestId = request.headers['x-sargosh-request-id'];
    const trace = new TimingTrace(timingId(id) ? id : timingId(requestId) ? requestId : randomUUID(), 'server',
      timingId(requestId) ? requestId : undefined, sink);
    traces.set(request, trace);
    cached.set(request, false);
    totals.set(request, trace.span(path.endsWith('dictations') ? 'server.dictation.total' : path.endsWith('cleanup') ? 'server.cleanup.total' : 'server.stt.total', { practice: path.includes('/practice/') }));
  });
  server.addHook('preParsing', async (request, _reply, payload) => {
    const trace = traces.get(request);
    if (trace) bodies.set(request, trace.span('server.body'));
    return payload;
  });
  server.addHook('preValidation', async request => { bodies.get(request)?.end(); });
  server.addHook('onError', async request => { bodies.get(request)?.end('failed'); });
  server.addHook('onResponse', async (request, reply) => {
    bodies.get(request)?.end(reply.statusCode < 400 ? 'ok' : 'failed');
    totals.get(request)?.end(reply.statusCode < 400 ? 'ok' : 'failed', { statusCode: reply.statusCode, cached: cached.get(request) });
  });
  server.addHook('onRequestAbort', async request => { cancelRequestTiming(request); });
  server.addHook('onTimeout', async request => { bodies.get(request)?.end('failed'); totals.get(request)?.end('failed'); });
}
export type ProviderMeasure = <T>(stage: 'headers' | 'body', work: () => Promise<T>) => Promise<T>;
export function providerTiming(request: FastifyRequest, kind: 'stt' | 'cleanup'): ProviderMeasure {
  return (stage, work) => timeRequest(request, `provider.${kind}.${stage}`, work);
}
export function timeRequest<T>(request: FastifyRequest, stage: TimingStage, work: () => Promise<T>, meta?: TimingMeta, signal?: AbortSignal) {
  const trace = traces.get(request);
  return trace ? trace.measure(stage, work, meta, signal) : work();
}

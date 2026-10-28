import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createServer } from '../src/server/app';
describe('local server', () => {
  it('responds to health checks without exposing credentials', async () => {
    const app = createServer();
    try { const response = await app.inject({ method: 'GET', headers: { host: '127.0.0.1:4318' }, url: '/health' }); expect(response.statusCode).toBe(200); expect(response.json()).toEqual({ status: 'ok', service: 'sargosh-api', version: JSON.parse(readFileSync('package.json', 'utf8')).version }); } finally { await app.close(); }
  });
  it('reports provider integrations as unavailable until installed', async () => {
    const app = createServer();
    try { expect((await app.inject({ method: 'GET', headers: { host: '127.0.0.1:4318' }, url: '/v1/readiness' })).json()).toEqual({ auth: false, stt: false, cleanup: false }); } finally { await app.close(); }
  });
  it('fails closed instead of pretending to transcribe or accepting unprotected AI calls', async () => {
    const app = createServer();
    try { const response = await app.inject({ method: 'POST', headers: { host: '127.0.0.1:4318' }, url: '/v1/transcriptions', payload: {} }); expect(response.statusCode).toBe(503); expect(response.json().code).toBe('NOT_CONFIGURED'); } finally { await app.close(); }
  });
});

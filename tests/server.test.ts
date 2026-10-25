import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server/app';
describe('local server', () => {
  it('responds to health checks without exposing credentials', async () => {
    const app = createServer();
    try { const response = await app.inject({ method: 'GET', url: '/health' }); expect(response.statusCode).toBe(200); expect(response.json()).toEqual({ status: 'ok', service: 'sargosh-api', version: '0.1.0' }); } finally { await app.close(); }
  });
  it('reports provider integrations as unavailable until installed', async () => {
    const app = createServer();
    try { expect((await app.inject({ method: 'GET', url: '/v1/readiness' })).json()).toEqual({ auth: false, stt: false, cleanup: false }); } finally { await app.close(); }
  });
  it('fails closed instead of pretending to transcribe or accepting unprotected AI calls', async () => {
    const app = createServer();
    try { const response = await app.inject({ method: 'POST', url: '/v1/transcriptions', payload: {} }); expect(response.statusCode).toBe(503); expect(response.json().code).toBe('NOT_CONFIGURED'); } finally { await app.close(); }
  });
});

import { expect, it, vi } from 'vitest';
import { createServer } from '../src/server/app';
import type { UsageStore } from '../src/server/usage';
it('deletes only the authenticated account with explicit confirmation and blocks replay after deletion', async () => {
  let exists = true;
  const remove = vi.fn(async () => { exists = false; });
  const app = createServer({ hostedMode: true, allowedHosts: ['api.test'], usageStore: {} as UsageStore, apiKey: 'fixture', geminiApiKey: 'fixture', verifySession: async token => token === 'valid' && exists ? 'self-id' : null, deleteAccount: remove });
  const submit = (payload: object, token = 'valid') => app.inject({ method: 'DELETE', url: '/v1/account', headers: { host: 'api.test', authorization: 'Bearer ' + token }, payload });
  try {
    expect((await submit({ confirmation: 'DELETE' }, 'expired')).statusCode).toBe(401);
    expect((await submit({ confirmation: 'DELETE', userId: 'someone-else' })).statusCode).toBe(400);
    expect((await submit({ confirmation: 'yes' })).statusCode).toBe(400); expect(remove).not.toHaveBeenCalled();
    expect((await submit({ confirmation: 'DELETE' })).json()).toEqual({ deleted: true });
    expect(remove).toHaveBeenCalledExactlyOnceWith('self-id');
    expect((await submit({ confirmation: 'DELETE' })).statusCode).toBe(401);
  } finally { await app.close(); }
});
it('reports a sanitized deletion failure without claiming success', async () => {
  const app = createServer({ hostedMode: true, allowedHosts: ['api.test'], usageStore: {} as UsageStore, apiKey: 'fixture', geminiApiKey: 'fixture', verifySession: async () => 'self-id', deleteAccount: async () => { throw new Error('private secret'); } });
  try { const response = await app.inject({ method: 'DELETE', url: '/v1/account', headers: { host: 'api.test', authorization: 'Bearer valid' }, payload: { confirmation: 'DELETE' } }); expect(response.statusCode).toBe(503); expect(response.body).not.toContain('private secret'); } finally { await app.close(); }
});

import { createClient } from '@supabase/supabase-js';
export function sessionVerifier(config: { url: string; key: string }) {
  const client = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000), redirect: 'error' }) } });
  return async (token: string): Promise<string | null> => {
    if (token.length > 8192 || !/^[A-Za-z0-9_.-]+$/.test(token)) return null;
    try { const { data, error } = await client.auth.getUser(token); return error ? null : data.user?.id ?? null; } catch { return null; }
  };
}

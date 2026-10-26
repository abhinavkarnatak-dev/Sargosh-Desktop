import { createClient } from '@supabase/supabase-js';
export function accountDeleter(url: string, key: string) {
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000), redirect: 'error' }) }
  });
  return async (userId: string) => {
    const { error } = await client.auth.admin.deleteUser(userId, false);
    if (error) throw new Error('Account deletion could not complete. Please try again.');
  };
}

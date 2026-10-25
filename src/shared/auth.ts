export interface AccountUser { id: string; email: string; firstName: string; lastName: string }
export const hasProfileName = (user: AccountUser | null | undefined): boolean => Boolean(user?.firstName.trim());
export interface AuthState { configured: boolean; phase: 'loading' | 'signed-out' | 'signed-in'; user: AccountUser | null; googlePending: boolean; message: string }
export const INITIAL_AUTH: AuthState = { configured: false, phase: 'loading', user: null, googlePending: false, message: '' };
export const isEmailCode = (value: unknown): value is string => typeof value === 'string' && /^[0-9]{6}$/.test(value);
export const validEmail = (value: unknown): value is string => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export function publicAuthConfig(environment: Record<string, string | undefined>) {
  const url = environment.SUPABASE_URL?.trim(); const key = environment.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url && !key) return undefined;
  try {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' || !key || !/^sb_publishable_[A-Za-z0-9_-]{10,500}$/.test(key)) return undefined;
    return { url: parsed.origin, key };
  } catch { return undefined; }
}

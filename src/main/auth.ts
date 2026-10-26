import { createClient, type SupabaseClient, type Session, type User } from '@supabase/supabase-js';
import { INITIAL_AUTH, validEmail, isEmailCode, hasProfileName, type AuthState, type AccountUser } from '../shared/auth';
import type { AuthStorage } from './auth-storage';
import { GoogleCallback } from './google-callback';
function profile(user: User): AccountUser {
  const metadata = user.user_metadata ?? {}; const full = typeof metadata.full_name === 'string' ? metadata.full_name.trim().split(/\s+/) : [];
  return { id: user.id, email: user.email ?? '', firstName: String(metadata.first_name ?? full.shift() ?? '').slice(0,80), lastName: String(metadata.last_name ?? full.join(' ')).slice(0,80) };
}
export class DesktopAuth {
  private client?: SupabaseClient;
  private disposed = false;
  private shutdown = new AbortController();
  private state: AuthState = { ...INITIAL_AUTH };
  private current: Session | null = null; private switching: Promise<unknown> = Promise.resolve();
  private googleExchanging = false;
  private otpEmail = ''; private lastEmail = 0; private google = new GoogleCallback();
  private unsubscribe?: () => void; private generation = 0;
  constructor(private config: { url: string; key: string } | undefined, private storage: AuthStorage, private switched: (id: string | null) => Promise<void>, private changed: (state: AuthState) => void, private openBrowser: (url: string) => Promise<void>) {
    this.state.configured = Boolean(config);
    if (config) this.client = createClient(config.url, config.key, { auth: { storage, storageKey: 'sargosh-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([this.shutdown.signal, ...(init?.signal ? [init.signal] : []), AbortSignal.timeout(15000)]), redirect: 'error' }) } });
  }
  snapshot() { return this.state; }
  private publish(update: Partial<AuthState>) { this.state = { ...this.state, ...update }; this.changed(this.state); }
  private accept(session: Session | null) {
    const work = this.switching.then(async () => {
      if (this.disposed) return;
      const oldId = this.current?.user.id ?? null; const nextId = session?.user.id ?? null;
      if (this.state.phase === 'loading' || oldId !== nextId) { this.publish({ phase: 'loading' }); await this.switched(nextId); }
      if (this.disposed) return;
      this.current = session;
      this.publish({ phase: session ? 'signed-in' : 'signed-out', user: session ? profile(session.user) : null, message: '', googlePending: false });
    });
    this.switching = work.catch(() => {}); return work;
  }
  async initialize() {
    if (!this.client) { await this.accept(null); return; }
    try {
      const { data, error } = await this.client.auth.getSession(); if (error) throw error;
      if (data.session) {
        const verified = await this.client.auth.getUser(); if (verified.error || !verified.data.user) throw new Error();
        await this.accept({ ...data.session, user: verified.data.user });
      } else await this.accept(null);
    } catch { this.current = null; this.publish({ phase: 'signed-out', user: null, message: 'Could not restore sign-in. Check your connection and restart Sargosh, or sign in again.' }); }
    const { data: subscription } = this.client.auth.onAuthStateChange((event, session) => { if (event === 'INITIAL_SESSION') return; const generation = this.generation; setTimeout(() => { if (generation === this.generation) void this.accept(session).catch(() => this.publish({ phase: 'signed-out', user: null, message: 'Your local account could not be opened. Restart Sargosh.' })); }, 0); });
    this.unsubscribe = () => subscription.subscription.unsubscribe();
  }
  private ready() { if (this.disposed) throw new Error('Sargosh is closing.'); if (!this.client) throw new Error('Supabase sign-in is not configured.'); return this.client; }
  async sendCode(email: unknown) {
    if (!validEmail(email)) throw new Error('Enter a valid email address.');
    if (Date.now() - this.lastEmail < 60000) throw new Error('Wait one minute before requesting another OTP.');
    this.lastEmail = Date.now();
    const { error } = await this.ready().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    if (error) throw new Error('Could not send the OTP. Check Supabase email setup or wait before retrying.');
    this.otpEmail = email.trim();
  }
  async verifyCode(email: unknown, token: unknown) {
    if (!validEmail(email) || email.trim() !== this.otpEmail) throw new Error('Enter the OTP from the latest sign-in email.');
    if (!isEmailCode(token)) throw new Error('Enter the 6-digit OTP from the latest email.');
    const { data, error } = await this.ready().auth.verifyOtp({ email: email.trim(), token, type: 'email' });
    if (error || !data.session) throw new Error('That OTP is invalid or expired. Check the email or request another OTP.');
    await this.accept(data.session); this.otpEmail = '';
  }
  async signInGoogle() {
    const client = this.ready(); if (this.state.googlePending) throw new Error('Google sign-in is already open.');
    this.publish({ googlePending: true, message: '' });
    try {
      const redirectTo = await this.google.listen(async code => {
        this.googleExchanging = true;
        try {
          const { data, error } = await client.auth.exchangeCodeForSession(code);
          if (error || !data.session) throw new Error();
          await this.accept(data.session);
        } catch {
          this.publish({ googlePending: false, message: 'Google sign-in could not complete. Try again.' });
          throw new Error('Google sign-in could not complete.');
        } finally { this.googleExchanging = false; }
      }, () => this.publish({ googlePending: false, message: 'Google sign-in did not complete. Please try again.' }));
      const { data, error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true, scopes: 'openid email profile' } });
      if (error || !data.url) throw new Error();
      const target = new URL(data.url); const expected = new URL(this.config!.url);
      if (target.origin !== expected.origin || target.pathname !== '/auth/v1/authorize') throw new Error();
      await this.openBrowser(data.url);
    } catch { this.google.close(); this.publish({ googlePending: false }); throw new Error('Could not open Google sign-in. Check the Google provider and redirect settings in Supabase.'); }
  }
  cancelGoogle() { if (this.googleExchanging) throw new Error('Google sign-in is finishing. Please wait a moment.'); this.google.close(); this.publish({ googlePending: false, message: '' }); }
  async updateProfile(firstName: unknown, lastName: unknown) {
    if (!this.current || typeof firstName !== 'string' || !firstName.trim() || typeof lastName !== 'string' || firstName.length > 80 || lastName.length > 80 || /[\x00-\x1f]/.test(firstName + lastName)) throw new Error('Enter your first name. Each name can be up to 80 characters.');
    const { data, error } = await this.ready().auth.updateUser({ data: { first_name: firstName.trim(), last_name: lastName.trim() } });
    if (error || !data.user) throw new Error('Your profile could not be saved. Please try again.');
    await this.accept({ ...this.current, user: data.user });
  }
  async accessToken() {
    if (!this.current || this.state.phase !== 'signed-in') throw new Error('Sign in to use cloud dictation.');
    if (!hasProfileName(this.state.user)) throw new Error('Enter your name to finish setting up Sargosh.');
    const { data, error } = await this.ready().auth.getSession();
    if (error || !data.session || data.session.user.id !== this.current.user.id) throw new Error('Sign in again to use cloud dictation.');
    return data.session.access_token;
  }
  async signOut() { this.cancelGoogle(); const { error } = await this.ready().auth.signOut({ scope: 'local' }); if (error) throw new Error('Could not sign out. Check your connection and try again.'); await this.accept(null); }
  async forgetDeletedAccount() {
    this.generation++; this.cancelGoogle();
    await this.ready().auth.stopAutoRefresh();
    try { await this.ready().auth.signOut({ scope: 'local' }); } catch { /* The remote account may already be gone. */ }
    await this.storage.clear();
    await this.accept(null);
  }
  async dispose() { this.disposed = true; this.generation++; this.unsubscribe?.(); this.google.close(); this.shutdown.abort(); await this.client?.auth.stopAutoRefresh(); await this.switching; }
}

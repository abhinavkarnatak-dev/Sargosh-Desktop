import { useEffect, useRef, useState } from 'react';
import { isEmailCode, type AuthState } from '../shared/auth';
export function SignIn({ state }: { state: AuthState }) {
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { const theme = query.matches ? 'dark' : 'light'; document.documentElement.dataset.theme = theme; void window.sargosh?.setWindowTheme?.(theme).catch(() => {}); };
    apply(); query.addEventListener('change', apply); return () => query.removeEventListener('change', apply);
  }, []);
  const [email, setEmail] = useState(''); const [code, setCode] = useState(''); const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [resendAt, setResendAt] = useState(0);
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (sent && !busy) codeInput.current?.focus(); }, [sent, busy]);
  async function action(work: () => Promise<void>) { if (busy) return; setBusy(true); setMessage(''); try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Sign-in could not complete. Please try again.'); } finally { setBusy(false); } }
  return <div className="sign-in-screen"><div className="sign-in-titlebar" /><main className="sign-in-card">
    <img className="brand-dark" src="./brand/logo-dark.png" alt="Sargosh" /><img className="brand-light" src="./brand/logo-light.png" alt="Sargosh" />
    <h1>{sent ? 'Verify your OTP' : 'Welcome to Sargosh'}</h1><p className="subtitle">{sent ? <>Enter the 6-digit OTP sent to <strong className="otp-destination">{email.trim()}</strong></> : 'Speak freely. Stay in your flow.'}</p>
    {state.phase === 'loading' ? <p role="status">Opening your account...</p> : !state.configured ? <p role="alert">Sign-in is not configured. Add the Supabase Project URL and publishable key, then restart the desktop app.</p> : <>
      {!sent && <><button className="button sign-in-google" disabled={busy || state.googlePending} onClick={() => void action(() => window.sargosh!.signInGoogle())}><img src="./brand/google-g.png" width={20} height={20} alt="" aria-hidden="true" /><span>{state.googlePending ? 'Waiting for Google...' : 'Continue with Google'}</span></button>
      {state.googlePending && <button className="text-button" onClick={() => void action(() => window.sargosh!.cancelGoogleSignIn())}>Cancel Google sign-in</button>}
      <div className="sign-in-divider">or use email</div></>}
      <form onSubmit={event => { event.preventDefault(); void action(async () => {
        if (sent) {
          if (!isEmailCode(code.trim())) throw new Error('Enter the 6-digit OTP from the latest email.');
          await window.sargosh!.verifyEmailCode(email.trim(), code.trim());
        }
        else { await window.sargosh!.sendEmailCode(email.trim()); setSent(true); setResendAt(Date.now() + 60000); }
      }); }}>
        {!sent && <><label htmlFor="sign-in-email">Email</label><input id="sign-in-email" type="email" autoComplete="email" required maxLength={254} value={email} disabled={busy || sent || state.googlePending} onChange={event => setEmail(event.target.value)} /></>}
        {sent && <><label htmlFor="sign-in-code">OTP</label><input ref={codeInput} id="sign-in-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} disabled={busy || state.googlePending} onChange={event => { const value = event.target.value.replace(/[^0-9]/g,''); if (value.length > 6) { setMessage('Enter the 6-digit OTP from the latest email.'); return; } setCode(value); }} onPaste={event => { const value = event.clipboardData.getData('text').replace(/\s/g,''); event.preventDefault(); if (!isEmailCode(value)) { setMessage('Enter the 6-digit OTP from the latest email.'); return; } setMessage(''); setCode(value); }} autoFocus /><p className="inline-help">Check your spam folder if the OTP has not arrived.</p></>}
        <button className="button" type="submit" disabled={busy || state.googlePending}>{busy ? 'Please wait...' : sent ? 'Verify and sign in' : 'Send OTP'}</button>
      </form>
      {sent && <div className="sign-in-secondary"><button className="text-button" disabled={busy || state.googlePending} onClick={() => { setSent(false); setCode(''); setMessage(''); }}>Back to sign in</button><button className="text-button" disabled={busy || state.googlePending} onClick={() => void action(async () => { if (Date.now() < resendAt) throw new Error('Wait one minute before requesting another OTP.'); await window.sargosh!.sendEmailCode(email.trim()); setResendAt(Date.now() + 60000); setMessage('A new OTP has been sent.'); })}>Resend OTP</button></div>}
    </>}
    {(message || state.message) && <p className="sign-in-message" role="status">{message || state.message}</p>}
  </main></div>;
}

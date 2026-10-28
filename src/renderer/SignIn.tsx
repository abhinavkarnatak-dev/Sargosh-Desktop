import { LoaderCircle, X } from 'lucide-react';
import { SidebarLogo } from './SidebarLogo';
import { NoticeToast } from './NoticeToast';
import { OtpInput } from './OtpInput';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isEmailCode, type AuthState } from '../shared/auth';
export function SignIn({ state }: { state: AuthState }) {
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { const theme = query.matches ? 'dark' : 'light'; document.documentElement.dataset.theme = theme; void window.sargosh?.setWindowTheme?.(theme).catch(() => {}); };
    apply(); query.addEventListener('change', apply); return () => query.removeEventListener('change', apply);
  }, []);
  const [email, setEmail] = useState(''); const [code, setCode] = useState(''); const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [resendAt, setResendAt] = useState(0);
  const [now,setNow]=useState(Date.now);
  const [notice,setNotice]=useState<{id:number;message:string;variant:'success'|'info'}>({id:0,message:'',variant:'success'});
  const dismissNotice=useCallback(()=>setNotice(current=>({...current,message:''})),[]);
  const inFlight=useRef(false);
  const remaining=Math.max(0,Math.ceil((resendAt-now)/1000));
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(()=>{
    if(!sent || !resendAt)return;
    const tick=()=>{const time=Date.now();setNow(time);if(time>=resendAt)clearInterval(timer);};
    const timer=setInterval(tick,1000);tick();
    document.addEventListener('visibilitychange',tick);window.addEventListener('focus',tick);
    return ()=>{clearInterval(timer);document.removeEventListener('visibilitychange',tick);window.removeEventListener('focus',tick);};
  },[sent,resendAt]);
  function otpSent(resent:boolean){
    const time=Date.now();setNow(time);setResendAt(time+60000);setSent(true);setCode('');
    setNotice(current=>({id:current.id+1,variant:'success',message:resent?'A new OTP has been sent.':'OTP sent. Check your email.'}));
  }
  useEffect(() => { if (sent && !busy) codeInput.current?.focus(); }, [sent, busy]);
  async function action(work: () => Promise<void>) { if (inFlight.current) return; inFlight.current=true;setBusy(true); setMessage(''); try { await work(); } catch (error) { const text=error instanceof Error ? error.message : 'Sign-in could not complete. Please try again.';if(text==='Wait one minute before requesting another OTP.')setNotice(current=>({id:current.id+1,message:text,variant:'info'}));else setMessage(text); } finally { inFlight.current=false;setBusy(false); } }
  return <div className="sign-in-screen"><div className="sign-in-titlebar" /><main className="sign-in-card">
    <div className="sign-in-animated-logo" role="img" aria-label="Sargosh"><SidebarLogo /></div>
    <h1>{sent ? 'Verify your OTP' : 'Welcome to Sargosh'}</h1><p className="subtitle">{sent ? <>Enter the 6-digit OTP sent to <strong className="otp-destination">{email.trim()}</strong></> : 'Speak freely. Stay in your flow.'}</p>
    {state.phase === 'loading' ? <p role="status">Opening your account...</p> : !state.configured ? <p role="alert">Sign-in is not configured. Add the Supabase Project URL and publishable key, then restart the desktop app.</p> : <>
      {!sent && <><div className="sign-in-google-area" data-pending={state.googlePending}>
        <button className="button sign-in-google" data-tooltip="" disabled={busy || state.googlePending} aria-label={state.googlePending ? 'Waiting for Google' : 'Continue with Google'} onClick={() => void action(() => window.sargosh!.signInGoogle())}>
          <span className="sign-in-google-labels" aria-hidden="true"><span className="google-idle-label"><img src="./brand/google-g.png" width={20} height={20} alt="" />Continue with Google</span><span className="google-waiting-label"><LoaderCircle size={18} className="google-waiting-spinner" />Waiting for Google...</span></span>
        </button>
        <button className="sign-in-google-cancel" type="button" aria-label="Cancel sign-in" data-tooltip="Cancel sign-in" data-tooltip-placement="top" disabled={busy || !state.googlePending} tabIndex={state.googlePending ? 0 : -1} aria-hidden={!state.googlePending} onClick={() => void action(() => window.sargosh!.cancelGoogleSignIn())}><X size={16} /></button>
      </div>
      <div className="sign-in-divider">or use email</div></>}
      <form onSubmit={event => { event.preventDefault(); void action(async () => {
        if (sent) {
          if (!isEmailCode(code.trim())) throw new Error('Enter the 6-digit OTP from the latest email.');
          await window.sargosh!.verifyEmailCode(email.trim(), code.trim());
        }
        else { await window.sargosh!.sendEmailCode(email.trim()); otpSent(false); }
      }); }}>
        {!sent && <><label htmlFor="sign-in-email">Email</label><input id="sign-in-email" type="email" autoComplete="email" required maxLength={254} value={email} disabled={busy || sent || state.googlePending} onChange={event => setEmail(event.target.value)} /></>}
        {sent && <><label htmlFor="sign-in-code">OTP</label><OtpInput inputRef={codeInput} id="sign-in-code" value={code} disabled={busy || state.googlePending} onChange={value => { setCode(value); setMessage(''); }} onInvalid={setMessage} /><p className="inline-help" id="sign-in-code-help">Check your spam folder if the OTP has not arrived.</p></>}
        <button className="button" type="submit" disabled={busy || state.googlePending}>{busy ? 'Please wait...' : sent ? 'Verify and sign in' : 'Send OTP'}</button>
      </form>
      {sent && <div className="sign-in-secondary"><button className="text-button" disabled={busy || state.googlePending} onClick={() => { setSent(false); setCode(''); setMessage(''); }}>Back to sign in</button>{remaining>0 ? <span className="otp-resend-countdown" role="timer" aria-live="off">Resend OTP in {Math.floor(remaining/60)}:{String(remaining%60).padStart(2,'0')}</span> : <button className="text-button" disabled={busy || state.googlePending} onClick={() => { if(Date.now()<resendAt)return;void action(async () => { const time=Date.now();setNow(time);setResendAt(time+60000);await window.sargosh!.sendEmailCode(email.trim()); otpSent(true); }); }}>{busy?'Sending...':'Resend OTP'}</button>}</div>}
    </>}
    {(message || state.message) && <p className="sign-in-message" role="status">{message || state.message}</p>}
  </main>{notice.message && <NoticeToast key={notice.id} message={notice.message} variant={notice.variant} onDismiss={dismissNotice} />}</div>;
}

import { useEffect, useState } from 'react';
import { useAuth } from './auth';
export function AccountPanel() {
  const state = useAuth(); const user = state.user;
  const [firstName, setFirstName] = useState(''); const [lastName, setLastName] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  useEffect(() => { setFirstName(user?.firstName ?? ''); setLastName(user?.lastName ?? ''); }, [user?.id, user?.firstName, user?.lastName]);
  async function action(work: () => Promise<void>) { if (busy) return; setBusy(true); setMessage(''); try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : 'That action could not complete.'); } finally { setBusy(false); } }
  if (!user) return <p className="privacy-footnote">Open the desktop app and sign in to manage your account.</p>;
  return <><form className="account-form" onSubmit={event => { event.preventDefault(); void action(async () => { await window.sargosh!.updateProfile(firstName, lastName); setMessage('Profile saved.'); }); }}>
    <div className="settings-card"><label className="setting-row"><strong>First name</strong><input value={firstName} required maxLength={80} autoComplete="given-name" disabled={busy} onChange={event => setFirstName(event.target.value)} /></label><label className="setting-row"><strong>Last name</strong><input value={lastName} maxLength={80} autoComplete="family-name" disabled={busy} onChange={event => setLastName(event.target.value)} /></label><div className="setting-row"><strong>Email</strong><span>{user.email}</span></div><div className="setting-row"><strong>Profile picture</strong><span className="avatar">{(user.firstName || user.email).slice(0,1).toUpperCase()}</span></div></div>
    <div className="account-actions"><button className="button secondary" type="button" disabled={busy} onClick={() => void action(() => window.sargosh!.signOut())}>Sign out</button><button className="button" type="submit" disabled={busy}>{busy ? 'Please wait...' : 'Save'}</button></div>
  </form>{message && <p className="inline-help" role="status">{message}</p>}<p className="privacy-footnote">Your history stays on this computer and is kept separate for each account. Signing out hides it; signing back into the same account restores it.</p></>;
}

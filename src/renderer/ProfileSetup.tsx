import { useState } from 'react';
import type { AccountUser } from '../shared/auth';
export function ProfileSetup({ user }: { user: AccountUser }) {
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function action(work: () => Promise<void>) {
    if (busy) return; setBusy(true); setError('');
    try { await work(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save your name. Please try again.'); }
    finally { setBusy(false); }
  }
  return <div className="sign-in-screen"><div className="sign-in-titlebar" /><main className="sign-in-card">
    <img className="brand-dark" src="./brand/logo-dark.png" alt="Sargosh" /><img className="brand-light" src="./brand/logo-light.png" alt="Sargosh" />
    <h1>What should we call you?</h1><p className="subtitle">Add your name to finish setting up Sargosh.</p>
    <form onSubmit={event => { event.preventDefault(); void action(async () => {
      if (!firstName.trim()) throw new Error('Enter your first name.');
      await window.sargosh!.updateProfile(firstName.trim(), lastName.trim());
    }); }}>
      <label htmlFor="setup-first-name">First name</label><input id="setup-first-name" autoComplete="given-name" autoFocus required maxLength={80} value={firstName} disabled={busy} onChange={event => setFirstName(event.target.value)} />
      <label htmlFor="setup-last-name">Last name <span className="setup-optional">(optional)</span></label><input id="setup-last-name" autoComplete="family-name" maxLength={80} value={lastName} disabled={busy} onChange={event => setLastName(event.target.value)} />
      <button className="button" type="submit" disabled={busy || !firstName.trim()}>{busy ? 'Saving your name...' : 'Continue to Sargosh'}</button>
    </form>
    {error && <p className="sign-in-message" role="alert">{error}</p>}
    <p className="inline-help setup-account">Signed in as {user.email}</p>
    <button className="text-button" disabled={busy} onClick={() => void action(() => window.sargosh!.signOut())}>Use another account</button>
  </main></div>;
}

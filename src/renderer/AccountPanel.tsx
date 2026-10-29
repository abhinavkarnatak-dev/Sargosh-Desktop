import { NoticeToast } from './NoticeToast';
import { useModalDialog, useModalDismiss } from './modal';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './auth';
export function AccountPanel() {
  const [notice,setNotice]=useState(0);
  const dismissNotice=useCallback(()=>setNotice(0),[]);
  const state = useAuth(); const user = state.user;
  const [firstName, setFirstName] = useState(''); const [lastName, setLastName] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [deleting, setDeleting] = useState(false);
  useEffect(() => { setFirstName(user?.firstName ?? ''); setLastName(user?.lastName ?? ''); }, [user?.id, user?.firstName, user?.lastName]);
  async function action(work: () => Promise<void>) { if (busy) return; setBusy(true); setMessage(''); try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : 'That action could not complete.'); } finally { setBusy(false); } }
  if (!user) return <p className="privacy-footnote">Open the desktop app and sign in to manage your account.</p>;
  return <><form className="account-form" onSubmit={event => { event.preventDefault(); void action(async () => { await window.sargosh!.updateProfile(firstName, lastName); setMessage(''); setNotice(current=>current+1); }); }}>
    <div className="settings-card"><label className="setting-row"><strong>First name</strong><input value={firstName} required maxLength={80} autoComplete="given-name" disabled={busy} onChange={event => setFirstName(event.target.value)} /></label><label className="setting-row"><strong>Last name</strong><input value={lastName} maxLength={80} autoComplete="family-name" disabled={busy} onChange={event => setLastName(event.target.value)} /></label><div className="setting-row"><strong>Email</strong><span>{user.email}</span></div><div className="setting-row"><strong>Profile picture</strong><span className="avatar">{(user.firstName || user.email).slice(0,1).toUpperCase()}</span></div></div>
    <div className="account-actions"><button className="button secondary" type="button" disabled={busy} onClick={() => void action(() => window.sargosh!.signOut())}>Sign out</button><button className="button danger" type="button" disabled={busy} onClick={() => { setMessage(''); setDeleting(true); }}>Delete account</button><button className="button" type="submit" disabled={busy}>{busy ? 'Please wait...' : 'Save'}</button></div>
  </form>{notice>0 && <NoticeToast key={notice} message="Profile saved." variant="success" onDismiss={dismissNotice} />}{deleting && <DeleteAccountDialog email={user.email} busy={busy} message={message} onClose={() => { if (!busy) setDeleting(false); }} onConfirm={() => void action(async () => { await window.sargosh!.deleteAccount('DELETE'); setDeleting(false); })} />}{message && <p className="inline-help" role="status">{message}</p>}<p className="privacy-footnote">Your history stays on this computer and is kept separate for each account. Signing out hides it; signing back into the same account restores it.</p></>;
}

function DeleteAccountDialog({ email, busy, message, onClose: onDismissed, onConfirm }: { email: string; busy: boolean; message: string; onClose(): void; onConfirm(): void }) {
  const {closing,dismiss:onClose}=useModalDismiss(onDismissed);
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirmation, setConfirmation] = useState('');
  const outsidePress = useRef(false);
  useModalDialog(dialog);
  function outside(element: HTMLDialogElement, x: number, y: number) {
    const bounds = element.getBoundingClientRect();
    return x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom;
  }
  return <dialog ref={dialog} className="history-delete-dialog account-delete-dialog animated-modal" data-closing={closing} aria-labelledby="account-delete-title" aria-describedby="account-delete-description" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onPointerDown={event => { outsidePress.current = event.target === event.currentTarget && outside(event.currentTarget, event.clientX, event.clientY); }} onClick={event => {
    const dismiss = outsidePress.current && event.target === event.currentTarget && outside(event.currentTarget, event.clientX, event.clientY);
    outsidePress.current = false; if (dismiss && !busy) onClose();
  }}>
    <h2 id="account-delete-title">Delete your account?</h2>
    <p id="account-delete-description">Permanently delete <strong>{email}</strong>, your profile, and this computer’s history, recordings and preferences. <strong>This cannot be undone.</strong></p>
    <p>Limited usage and spending records remain. To prevent allowance abuse, a protected email identifier and used minutes are deleted within an hour after the monthly reset. No name or readable email is retained.</p>
    <label className="account-delete-confirm">Type DELETE to confirm<input value={confirmation} disabled={busy} autoComplete="off" spellCheck={false} onChange={event => setConfirmation(event.target.value)} /></label>
    {message && <p role="alert">{message}</p>}
    <div className="dialog-actions"><button className="button secondary" disabled={busy || closing} onClick={onClose}>Keep account</button><button className="button danger" disabled={closing || busy || confirmation !== 'DELETE'} onClick={onConfirm}>{busy ? 'Deleting account...' : 'Delete account permanently'}</button></div>
  </dialog>;
}

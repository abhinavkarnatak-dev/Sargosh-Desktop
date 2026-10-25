import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { cloudBusy, recording } from './audio/runtime';
import { recordingBusy } from '../shared/recording';
import { ShortcutSession } from './shortcut-session';
export function ShortcutEditor({ shortcut, onSave }: { shortcut: string; onSave(value: string): Promise<void> }) {
  const [editing, setEditing] = useState(false); const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(shortcut); const [message, setMessage] = useState('');
  const input = useRef<HTMLInputElement>(null); const candidate = useRef<string | null>(null);
  const save = useRef(onSave); save.current = onSave;
  const session = useRef<ShortcutSession | null>(null); const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const flow = new ShortcutSession(window.sargosh, value => save.current(value), () => cloudBusy() || recordingBusy(recording.getState())); session.current = flow;
    return () => { mounted.current = false; void flow.dispose().catch(() => {}); };
  }, []);
  useEffect(() => { if (!editing) setDraft(shortcut); }, [shortcut, editing]);
  useEffect(() => { if (editing && !busy) input.current?.focus(); }, [editing, busy]);
  async function change(cancel = false) {
    if (busy) return;
    setBusy(true); setMessage(''); candidate.current = null;
    try { if (cancel) await session.current!.cancel(); else await session.current!.begin(); if (mounted.current) setEditing(!cancel); }
    catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : 'Could not change the shortcut. Please try again.'); }
    finally { if (mounted.current) setBusy(false); }
  }
  function capture(event: KeyboardEvent<HTMLInputElement>) {
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') { void change(true); return; }
    if (event.repeat || ['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
    candidate.current = null;
    const key = event.code === 'Space' ? 'Space' : /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^F([1-9]|1[0-9]|2[0-4])$/.test(event.code) ? event.code : null;
    const modifiers = [event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Win'].filter(Boolean);
    const value = [...modifiers, key].join('+');
    if (!key || !modifiers.some(value => ['Control', 'Alt', 'Win'].includes(String(value))) || ['Alt+F4', 'Win+L'].includes(value)) {
      setMessage('Use Control, Alt, or Win with a letter, function key, or Space. Avoid Windows system shortcuts.'); return;
    }
    candidate.current = value; setDraft(value); setMessage('Release the keys to save.');
  }
  async function release(event: KeyboardEvent<HTMLInputElement>) {
    event.preventDefault(); event.stopPropagation();
    if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || !candidate.current || busy) return;
    const value = candidate.current; candidate.current = null; setBusy(true); setMessage('Saving shortcut...');
    try { await session.current!.save(value); if (mounted.current) { setEditing(false); setMessage('Shortcut saved.'); } }
    catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : 'Could not save the shortcut. Please try again.'); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <div className="inline-detail shortcut-editor"><div>
    <label className="shortcut-label" htmlFor="dictation-shortcut">Dictation shortcut</label>
    <div className="shortcut-editor-controls"><input ref={input} id="dictation-shortcut" className="shortcut-input" value={draft} readOnly disabled={!editing || busy} aria-describedby="dictation-shortcut-help" onKeyDown={capture} onKeyUp={event => void release(event)} onBlur={() => { candidate.current = null; }} />
      <button className="button secondary" disabled={busy} onClick={() => void change(editing)}>{busy ? 'Please wait...' : editing ? 'Cancel' : 'Change shortcut'}</button></div>
    <p id="dictation-shortcut-help" className="inline-help">{editing ? 'Press a combination, then release all keys. It saves automatically. Recording shortcuts are paused while you choose.' : 'The same shortcut works for hold-to-talk and double-tap hands-free.'}</p>
    {message && <p role="status" className="inline-help">{message}</p>}
  </div></div>;
}

import { useEffect, useState } from 'react';
import { Keyboard, Square, Target, X } from 'lucide-react';
import { INITIAL_WINDOWS_STATE, type WindowsState } from '../shared/windows';

export function WindowsTestPanel({ shortcut, onShortcut }: { shortcut: string; onShortcut(value: string): Promise<void> }) {
  const [state, setState] = useState<WindowsState>(INITIAL_WINDOWS_STATE);
  const [draft, setDraft] = useState(shortcut);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setDraft(shortcut); }, [shortcut]);
  useEffect(() => {
    if (!window.sargosh) return;
    const update = (next: WindowsState) => setState(current => next.revision >= current.revision ? next : current);
    const unsubscribe = window.sargosh.onWindowsState(update);
    void window.sargosh.windowsStatus().then(update, () => setError('The Windows helper is unavailable. Check the Python setup.'));
    return unsubscribe;
  }, []);
  async function run(action: () => Promise<WindowsState>) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const next = await action();
      setState(current => next.revision >= current.revision ? next : current);
    } catch { setError('The Windows test could not complete. Restart it before trying again.'); }
    finally { setBusy(false); }
  }
  if (state.enabled && state.purpose === 'recording') return <section className="windows-test" aria-label="Recording shortcuts active"><strong>Recording shortcuts are active</strong><p className="inline-help">Use the recording controls on Dictation. Disable recording shortcuts there before changing the shortcut or running the fixed-text input test.</p></section>;
  return <section className="windows-test" aria-labelledby="windows-test-title">
    <div className="windows-test-heading"><Keyboard size={17} /><div><h3 id="windows-test-title">Windows input test</h3><p>Development only. No audio is recorded and no AI service is called.</p></div></div>
    {!window.sargosh ? <p className="inline-help">Open the Electron desktop app to test global shortcuts and text insertion. These controls cannot run in a browser preview.</p> : <>
      <label className="shortcut-label" htmlFor="shortcut-capture">Dictation shortcut</label>
      <input id="shortcut-capture" className="shortcut-input" value={draft} readOnly disabled={state.enabled || busy} aria-describedby="shortcut-help" onKeyDown={event => {
        event.preventDefault();
        if (event.repeat || ['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
        const key = event.code === 'Space' ? 'Space' : /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^F([1-9]|1[0-9]|2[0-4])$/.test(event.code) ? event.code : null;
        const modifiers = [event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Win'].filter(Boolean);
        if (!key || !modifiers.some(value => ['Control', 'Alt', 'Win'].includes(String(value)))) { setError('Use Control, Alt, or Win with a letter, function key, or Space.'); return; }
        setError(''); setDraft([...modifiers, key].join('+'));
      }} />
      <p id="shortcut-help" className="inline-help">Click the field and press a combination. Hold it to test push-to-talk, or double-tap it to start and finish hands-free.</p>
      <div className="windows-test-actions">
        <button className="button secondary" disabled={busy} onClick={() => void run(async () => {
          if (state.enabled) return window.sargosh!.windowsAction('disarm');
          const next = await window.sargosh!.startWindowsTest(draft);
          if (next.enabled) await onShortcut(draft);
          return next;
        })}>{state.enabled ? <Square size={13} /> : <Keyboard size={14} />}{busy ? 'Working...' : state.enabled ? 'Stop input test' : 'Start input test'}</button>
        {state.enabled && ['pending', 'listening'].includes(state.phase) && <button className="button secondary" disabled={busy} onClick={() => void run(() => window.sargosh!.windowsAction('cancel'))}><X size={13} />Cancel session</button>}
      </div>
      <div className="windows-test-state" role="status"><strong>{state.phase === 'listening' ? state.mode === 'hold' ? 'Hold recognized' : 'Hands-free recognized' : state.phase === 'finished' ? 'Destination frozen' : state.enabled ? 'Input test active' : 'Input test off'}</strong><p>{state.message}</p><span><Target size={13} />{state.target ? state.target.application + ' - editable field' : 'No eligible input selected'}</span></div>
      <button className="button secondary" disabled={busy || !state.enabled || state.phase !== 'finished' || !state.target || state.deliveryAttempted} onClick={() => void run(() => window.sargosh!.insertWindowsTest(state.sessionId!))}>Insert fixed test sentence</button>
      <p className="inline-help">Inserts exactly "Sargosh input test." into the remembered field without using the clipboard. Existing selected text will be replaced. A hidden or unavailable field may reject delivery.</p>
    </>}
    {error && <p className="error-message" role="alert">{error}</p>}
  </section>;
}

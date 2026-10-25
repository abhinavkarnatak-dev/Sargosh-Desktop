import { useEffect, useState } from 'react';
import { Mic, Square, Trash2, X } from 'lucide-react';
import { recordingBusy } from '../shared/recording';
import type { Preferences } from '../shared/types';
import { INITIAL_WINDOWS_STATE, type WindowsState } from '../shared/windows';
import { cancelRecording, finishRecording, recording, startRecording, useRecording } from './audio/runtime';

export function RecordingPanel({ preferences }: { preferences: Preferences }) {
  const state = useRecording();
  const [native, setNative] = useState<WindowsState>(INITIAL_WINDOWS_STATE);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [audioURL, setAudioURL] = useState('');
  const busy = recordingBusy(state);
  const armed = native.enabled && native.purpose === 'recording';
  const blob = recording.getClip();
  useEffect(() => {
    if (!blob) { setAudioURL(''); return; }
    const url = URL.createObjectURL(blob); setAudioURL(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  useEffect(() => {
    if (!window.sargosh) return;
    const update = (next: WindowsState) => setNative(current => next.revision >= current.revision ? next : current);
    const unsubscribe = window.sargosh.onWindowsState(update);
    void window.sargosh.windowsStatus().then(update).catch(() => {});
    return unsubscribe;
  }, []);
  async function toggle() {
    if (working || busy) return;
    setWorking(true); setError('');
    try {
      const next = armed ? await window.sargosh!.windowsAction('disarm') : await window.sargosh!.startWindowsRecording(preferences.shortcut);
      setNative(current => next.revision >= current.revision ? next : current);
      if (!next.enabled && !armed) setError('Windows shortcuts could not start. Check the Python setup.');
    } catch { setError('Could not change recording shortcuts. Stop any active input test and try again.'); }
    finally { setWorking(false); }
  }
  return <section className="recording-panel" aria-labelledby="recording-heading">
    <div className="section-heading"><h2 id="recording-heading">Check your recording</h2><span>Local audio only</span></div>
    <p className="recording-intro">Record, finish, and listen back. Nothing is uploaded or inserted. Each new recording replaces the previous preview.</p>
    <div className="recording-actions">
      <button className="button" disabled={busy || working} onClick={() => { setError(''); void startRecording().catch(() => setError('Could not start recording. Restart the shortcut mode and try again.')); }}><Mic size={15} />Start recording</button>
      {busy && <><button className="button secondary" disabled={state.phase === 'finishing'} onClick={() => void finishRecording()}><Square size={14} />Finish recording</button><button className="button secondary" onClick={cancelRecording}><X size={14} />Cancel recording</button></>}
      {window.sargosh && <button className="button secondary" disabled={busy || working} onClick={() => void toggle()}>{working ? 'Working...' : armed ? 'Disable recording shortcuts' : 'Enable recording shortcuts'}</button>}
    </div>
    {window.sargosh ? <p className="inline-help">{armed ? 'Shortcuts ready: ' + native.shortcut + '. Hold and release, or double-tap to start and double-tap again to finish.' : 'Enable recording shortcuts to use this while Sargosh is in the background.'}</p> : <p className="inline-help">Browser preview supports these buttons. Global shortcuts and the floating control need the Electron app.</p>}
    <div className="recording-status" role="status"><strong>{state.phase === 'recording' ? 'Listening' : state.phase === 'opening' ? 'Starting' : state.phase === 'finishing' ? 'Finishing' : state.phase === 'ready' ? 'Ready to play' : state.phase === 'failed' ? 'Recording unavailable' : state.phase === 'cancelled' ? 'Cancelled' : 'Microphone off'}</strong><span>{Math.floor(state.durationMs / 60000)}:{String(Math.floor(state.durationMs / 1000) % 60).padStart(2, '0')}</span></div>
    <div className="meter" role="meter" aria-label="Recording microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.level}><span style={{ width: state.level + '%' }} /></div>
    <p className={state.phase === 'failed' ? 'error-message' : 'inline-help'}>{state.message}</p>
    {state.quiet && <p className="recording-quiet" role="status">No microphone activity detected. Check that your mic is not muted.</p>}
    {audioURL && <div className="recording-preview"><audio controls src={audioURL} aria-label="Latest local recording" /><button className="button secondary" onClick={() => recording.clear()}><Trash2 size={14} />Discard audio</button><span>{Math.round((state.clip?.bytes || 0) / 1024)} KB - {state.clip?.mimeType}</span></div>}
    {error && <p className="error-message" role="alert">{error}</p>}
    <p className="recording-footnote">Up to 5 minutes. The preview stays in memory until you replace it, discard it, or close the app. It is not added to dictation history.</p>
  </section>;
}

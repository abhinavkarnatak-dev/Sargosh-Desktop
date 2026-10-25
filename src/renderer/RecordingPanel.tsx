import { useSavedHistory } from './audio/history';
import { ThemedSelect } from './ThemedSelect';
import { useEffect, useState } from 'react';
import { Copy, Mic, Square, Trash2, X } from 'lucide-react';
import { STT_LANGUAGES, isSpeechLanguage } from '../shared/transcription';
import { recordingBusy } from '../shared/recording';
import type { Preferences } from '../shared/types';
import { INITIAL_WINDOWS_STATE, type WindowsState } from '../shared/windows';
import { cancelRecording, delivery, useDelivery, cleanup, cleanupTranscript, useCleanup, finishRecording, recording, startRecording, transcribeRecording, transcription, useTranscription, useRecording } from './audio/runtime';

export function RecordingPanel({ preferences }: { preferences: Preferences }) {
  const state = useRecording();
  const speech = useTranscription();
  const clean = useCleanup();
  const archive = useSavedHistory();
  const insertion = useDelivery();
  const inserting = insertion.phase === 'working';
  const cleaning = clean.phase === 'working';
  const outputText = clean.result ? clean.result.text : speech.result?.text || '';
  const transcribing = speech.phase === 'working';
  const [native, setNative] = useState<WindowsState>(INITIAL_WINDOWS_STATE);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [audioURL, setAudioURL] = useState('');
  const busy = recordingBusy(state);
  const processing = busy || transcribing || cleaning || inserting || archive.retryingId !== null;
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
    if (working || processing) return;
    setWorking(true); setError('');
    try {
      const next = armed ? await window.sargosh!.windowsAction('disarm') : await window.sargosh!.startWindowsRecording(preferences.shortcut);
      setNative(current => next.revision >= current.revision ? next : current);
      if (!next.enabled && !armed) setError('Windows shortcuts could not start. Check the Python setup.');
    } catch { setError('Could not change recording shortcuts. Stop any active input test and try again.'); }
    finally { setWorking(false); }
  }
  return <section className="recording-panel" aria-labelledby="recording-heading">
    <div className="section-heading"><h2 id="recording-heading">Check your recording</h2><span>Local recording - cloud transcription</span></div>
    <p className="recording-intro">Record and listen back, then transcribe with Deepgram. Cleanup sends the transcript text to Gemini when enabled. Each new recording replaces the previous preview.</p>
    <div className="recording-actions">
      <button className="button" disabled={processing || working} onClick={() => { setError(''); void startRecording().catch(() => setError('Could not start recording. Restart the shortcut mode and try again.')); }}><Mic size={15} />Start recording</button>
      {busy && <><button className="button secondary" disabled={state.phase === 'finishing'} onClick={() => void finishRecording()}><Square size={14} />Finish recording</button><button className="button secondary" onClick={cancelRecording}><X size={14} />Cancel recording</button></>}
      {window.sargosh && <button className="button secondary" disabled={processing || working} onClick={() => void toggle()}>{working ? 'Working...' : armed ? 'Disable recording shortcuts' : 'Enable recording shortcuts'}</button>}
    </div>
    {window.sargosh ? <p className="inline-help">{armed ? 'Shortcuts ready: ' + native.shortcut + '. Hold and release, or double-tap to start and double-tap again to finish.' : 'Enable recording shortcuts to use this while Sargosh is in the background.'}</p> : <p className="inline-help">Browser preview supports these buttons. Global shortcuts and the floating control need the Electron app.</p>}
    <div className="transcription-options">
      <label htmlFor="transcription-language">Speech language</label>
      <ThemedSelect id="transcription-language" value={speech.language} disabled={processing} options={STT_LANGUAGES} onChange={value => { if (isSpeechLanguage(value)) transcription.configure({ language: value }); }} />
      <label className="automatic-transcription"><input type="checkbox" checked={speech.automatic} disabled={processing} onChange={event => transcription.configure({ automatic: event.target.checked })} />Transcribe automatically after recording</label>
      <label className="automatic-transcription"><input type="checkbox" checked={clean.enabled} disabled={processing} onChange={event => cleanup.configure(event.target.checked)} />Clean up with Gemini after transcription</label>
    </div>
    <div className="recording-status" role="status"><strong>{state.phase === 'recording' ? 'Listening' : state.phase === 'opening' ? 'Starting' : state.phase === 'finishing' ? 'Finishing' : state.phase === 'ready' ? 'Ready to play' : state.phase === 'failed' ? 'Recording unavailable' : state.phase === 'cancelled' ? 'Cancelled' : 'Microphone off'}</strong><span>{Math.floor(state.durationMs / 60000)}:{String(Math.floor(state.durationMs / 1000) % 60).padStart(2, '0')}</span></div>
    <div className="meter" role="meter" aria-label="Recording microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.level}><span style={{ width: state.level + '%' }} /></div>
    <p className={state.phase === 'failed' ? 'error-message' : 'inline-help'}>{state.message}</p>
    {state.quiet && <p className="recording-quiet" role="status">No microphone activity detected. Check that your mic is not muted.</p>}
    {audioURL && <div className="recording-preview"><audio controls src={audioURL} aria-label="Latest local recording" /><button className="button secondary" onClick={() => recording.clear()}><Trash2 size={14} />Clear preview</button><span>{Math.round((state.clip?.bytes || 0) / 1024)} KB - {state.clip?.mimeType}</span></div>}
    {state.phase === 'ready' && state.clip && <div className="transcription-actions"><button className="button" disabled={processing} onClick={() => void transcribeRecording()}>{transcribing ? 'Transcribing...' : speech.phase === 'completed' ? 'Transcribe again' : 'Transcribe recording'}</button>{transcribing && <button className="button secondary" onClick={() => transcription.cancel()}>Cancel transcription</button>}</div>}
    {speech.phase !== 'idle' && <section className="transcript-panel" aria-label="Deepgram transcript"><div role="status"><strong>{cleaning ? 'Cleaning with Gemini' : speech.phase === 'working' ? 'Transcribing' : speech.phase === 'completed' ? clean.result ? 'Cleaned text' : 'Deepgram transcript' : speech.phase === 'cancelled' ? 'Transcription cancelled' : 'Transcription unavailable'}</strong><p className={speech.phase === 'failed' ? 'error-message' : 'inline-help'}>{speech.message}</p></div>{clean.phase !== 'idle' && <p className={clean.phase === 'failed' ? 'error-message' : 'inline-help'} role="status">{clean.message}</p>}{speech.result?.text && <><p className="transcript-text">{outputText}</p><button className="button secondary" disabled={cleaning || inserting || !outputText} onClick={() => void navigator.clipboard.writeText(outputText).then(() => setError(''), () => setError('Could not copy the transcript.'))}><Copy size={14} />Copy {clean.result ? 'cleaned text' : 'transcript'}</button><div className="transcription-actions"><button className="button secondary" disabled={processing} onClick={() => void cleanupTranscript()}>{clean.result ? 'Clean up again' : clean.phase === 'failed' || clean.phase === 'cancelled' ? 'Retry cleanup' : 'Clean up transcript'}</button>{cleaning && <button className="button secondary" onClick={() => cleanup.cancel()}>Cancel cleanup</button>}</div>{clean.phase !== 'idle' && <details className="original-transcript"><summary>Original Deepgram transcript</summary><p className="transcript-text">{speech.result.text}</p><button className="button secondary" onClick={() => void navigator.clipboard.writeText(speech.result!.text).catch(() => setError('Could not copy the original transcript.'))}>Copy original</button></details>}</>}</section>}
    {insertion.phase !== 'idle' && <div role="status" className={insertion.phase === 'failed' ? 'error-message' : 'inline-help'}><p>{insertion.message}</p>{inserting && <button className="button secondary" onClick={() => delivery.cancel()}>Stop insertion</button>}</div>}
    {archive.error && <p className="error-message" role="alert">{archive.error}</p>}
    {error && <p className="error-message" role="alert">{error}</p>}
    <p className="recording-footnote">Up to 5 minutes. The preview stays in memory until you replace it, discard it, or close the app. Finished recordings are saved to local history in the desktop app. Cloud transcription sends audio to Deepgram; enabled cleanup sends transcript text to Google Gemini. These calls use the provider quotas or credits; retries happen only when you request them.</p>
  </section>;
}

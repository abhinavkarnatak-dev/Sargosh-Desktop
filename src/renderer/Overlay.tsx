import { shortcutLabel } from '../shared/shortcut-label';
import { recordingNotice, type OverlayNotice } from '../shared/overlay-notice';
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Copy, GripVertical, LoaderCircle, Mic, X } from 'lucide-react';
import type { TranscriptionStatus } from '../shared/transcription';
import { INITIAL_RECORDING_STATE, recordingBusy, type RecordingState } from '../shared/recording';
import { INITIAL_WINDOWS_STATE, type WindowsState } from '../shared/windows';
export function Overlay() {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<WindowsState>(INITIAL_WINDOWS_STATE);
  const [audio, setAudio] = useState<RecordingState>(INITIAL_RECORDING_STATE);
  const [speech, setSpeech] = useState<TranscriptionStatus>({ phase: 'idle', message: '' });
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState<string | null>(null);
  const noticeElement = useRef<HTMLDivElement>(null);
  useEffect(() => { setError(''); }, [audio.sessionId]);
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!window.sargosh) return;
    const update = (next: WindowsState) => setState(current => next.revision >= current.revision ? next : current);
    const unsubscribe = window.sargosh.onWindowsState(update);
    void window.sargosh.windowsStatus().then(update).catch(() => {});
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (!window.sargosh) return;
    const update = (next: RecordingState) => setAudio(current => next.revision >= current.revision ? next : current);
    const unsubscribe = window.sargosh.onRecordingState(update);
    void window.sargosh.recordingStatus().then(update).catch(() => {});
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (!window.sargosh) return;
    const unsubscribe = window.sargosh.onTranscriptionState(setSpeech);
    void window.sargosh.transcriptionStatus().then(setSpeech).catch(() => {});
    return unsubscribe;
  }, []);
  const cloudActive = speech.phase === 'working';
  const audioActive = recordingBusy(audio);
  const preparing = audio.phase === 'finishing' || cloudActive;
  const active = state.enabled && ['pending', 'listening'].includes(state.phase);
  const notice = error ? { id: 'control:' + error, kind: 'error' as const, title: 'Control unavailable', message: error } : recordingNotice(audio, speech);
  const visibleNotice = notice && notice.id !== dismissed ? notice : null;
  useEffect(() => { if (!notice) setDismissed(null); }, [notice?.id]);
  useEffect(() => {
    const element = noticeElement.current;
    const resize = () => { void window.sargosh?.resizeOverlay?.(element ? Math.min(400, Math.max(120, Math.ceil(element.getBoundingClientRect().height + 80))) : 120).catch(() => {}); };
    resize();
    if (!element) return;
    const observer = new ResizeObserver(resize); observer.observe(element);
    return () => observer.disconnect();
  }, [visibleNotice?.id]);
  async function recordingAction(value: 'cancel' | 'finish') {
    setError('');
    try {
      if (!window.sargosh?.recordingAction) throw new Error();
      await window.sargosh.recordingAction(value);
    } catch { setError('Control unavailable. Quit Sargosh from the tray and reopen it.'); }
  }
  async function action(value: 'cancel' | 'finish' | 'start-hands-free') {
    setError('');
    try { if (!window.sargosh) throw new Error(); const next = await window.sargosh.windowsAction(value); if (next) setState(current => next.revision >= current.revision ? next : current); }
    catch { setError('Control unavailable. Quit Sargosh from the tray and reopen it.'); }
  }
  return <div className="overlay-stage">
    {visibleNotice && <div ref={noticeElement} className="overlay-notice-wrap"><NoticeCard key={visibleNotice.id} notice={visibleNotice} onDismiss={() => { setDismissed(visibleNotice.id); setError(''); }} /></div>}
    <div className={(expanded || active || audioActive || cloudActive ? 'overlay-pill expanded' : 'overlay-pill') + (audioActive || cloudActive ? ' recording-active' : active ? ' input-test-active' : '')} onMouseEnter={() => setExpanded(true)} onMouseLeave={() => { if (!drag.current) setExpanded(false); }}>
      {preparing ? <div className="overlay-preparing" role="status" aria-label="Preparing text">
        <span className="overlay-wave" aria-hidden="true">{[0,1,2,3,4,5,6].map(index => <i key={index} style={{ height: '3px' }} />)}</span>
        <LoaderCircle className="overlay-spinner" size={16} aria-hidden="true" />
      </div> : audioActive ? <>
        <button className="overlay-mic" aria-label="Cancel recording" data-tooltip="Cancel" onClick={() => void recordingAction('cancel')}><X size={15} /></button>
        {audio.phase === 'recording' ? <span className="overlay-wave" role="img" aria-label={audio.quiet ? 'No microphone activity' : 'Listening'} data-tooltip={audio.quiet ? 'No microphone activity. Check your mic.' : audio.mode === 'hands-free' ? 'Press ' + shortcutLabel(state.shortcut) + ' to finish and paste' : 'Listening'}>{[.35,.65,.85,1,.85,.65,.35].map((weight, index) => <i key={index} style={{ height: Math.max(3, audio.level * .24 * weight) + 'px' }} />)}</span> : <span className="overlay-recording-status">{audio.phase === 'opening' ? 'Starting...' : 'Finishing...'}</span>}
        {audio.mode !== 'hold' && <button className="overlay-mic" aria-label="Finish recording" data-tooltip="Finish and paste" disabled={audio.phase === 'finishing'} onClick={() => void recordingAction('finish')}><Check size={15} /></button>}
      </> : active && state.purpose === 'recording' ? <span className="overlay-recording-status">Starting...</span> : active ? <>
        <button className="overlay-mic" aria-label="Cancel input test session" data-tooltip="Cancel" onClick={() => void action('cancel')}><X size={15} /></button>
        <span className="overlay-test-label" data-tooltip="Input tracking only. No audio is recorded.">{state.phase === 'pending' ? 'Starting test' : state.mode === 'hold' ? 'Hold test' : 'Input test'}</span>
        {state.mode === 'hands-free' && <button className="overlay-mic" aria-label="Finish input test session" data-tooltip="Finish input test" onClick={() => void action('finish')}><Check size={15} /></button>}
      </> : expanded ? <>
        <button className="overlay-grip" aria-label="Move dictation control" onPointerDown={event => { drag.current = { x: event.screenX, y: event.screenY }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (!drag.current) return; const dx = event.screenX - drag.current.x; const dy = event.screenY - drag.current.y; drag.current = { x: event.screenX, y: event.screenY }; void window.sargosh?.moveOverlay(dx, dy); }} onPointerUp={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}><GripVertical size={15} /></button>
        <button className="overlay-mic" aria-label={state.enabled ? state.purpose === 'recording' ? 'Start hands-free recording' : 'Start hands-free input test' : 'Open Sargosh to set up dictation'} data-tooltip="" onClick={() => state.enabled ? void action('start-hands-free') : void window.sargosh?.openMain()}><Mic size={19} /></button>
        <span className="overlay-tooltip">{state.enabled ? (state.purpose === 'recording' ? 'Dictate - ' : 'Input test - ') + shortcutLabel(state.shortcut) : 'Set up dictation in Sargosh'}</span>
      </> : <span className="idle-line" />}
    </div>
  </div>;
}

function NoticeCard({ notice, onDismiss }: { notice: OverlayNotice; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  async function openHelp() {
    try {
      if (!window.sargosh) throw new Error();
      if (/microphone|recording|speech/i.test(notice.title)) await window.sargosh.openSettings();
      else await window.sargosh.openMain();
      onDismiss();
    } catch { setCopyError('Open Sargosh from the tray to check your dictation.'); }
  }
  async function copy() {
    try {
      if (!window.sargosh?.copyOverlayText) throw new Error();
      await window.sargosh.copyOverlayText(notice.id); setCopied(true); setCopyError('');
    } catch { setCopyError('Could not copy. Open Sargosh to recover your text.'); }
  }
  return <section className="overlay-notice" role={notice.kind === 'info' ? 'status' : 'alert'} aria-label={notice.title}>
    <header>{notice.kind !== 'info' && <span className={'overlay-notice-icon ' + notice.kind}><AlertCircle size={16} /></span>}<strong>{notice.title}</strong><button className="overlay-notice-close" aria-label="Dismiss notification" onClick={onDismiss}><X size={17} /></button></header>
    <p>{notice.message}</p>
    {notice.text && <div className="overlay-recovery-text" tabIndex={0} aria-label="Recovered dictation">{notice.text}</div>}
    <div className="overlay-notice-actions">
      {notice.text ? <button onClick={() => void copy()}><Copy size={13} />{copied ? 'Copied' : 'Copy text'}</button> : notice.kind === 'error' && <button onClick={() => void openHelp()}>{/microphone|recording|speech/i.test(notice.title) ? 'Microphone settings' : 'Open Sargosh'}</button>}
      {copyError && <span role="status">{copyError}</span>}
    </div>
  </section>;
}

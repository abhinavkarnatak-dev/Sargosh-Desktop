import { shortcutLabel } from '../shared/shortcut-label';
import { OverlayLanguage } from './OverlayLanguage';
import { useOverlayHitRegions } from './overlay-hit';
import { recordingNotice, type OverlayNotice } from '../shared/overlay-notice';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Copy, GripVertical, LoaderCircle, Mic, X } from 'lucide-react';
import type { TranscriptionStatus } from '../shared/transcription';
import { INITIAL_RECORDING_STATE, recordingBusy, type RecordingState } from '../shared/recording';
import { INITIAL_WINDOWS_STATE, type WindowsState } from '../shared/windows';
import { syncOverlayTheme } from './overlay-theme';
import { DEFAULT_DOCK, type DockState } from '../shared/overlay-dock';
export function Overlay() {
  useOverlayHitRegions();
  useEffect(syncOverlayTheme,[]);
  const [expanded, setExpanded] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [languagePresent, setLanguagePresent] = useState(false);
  const changeLanguageOpen = useCallback((open: boolean) => setLanguageOpen(open), []);
  useEffect(() => {
    if (languageOpen) { setLanguagePresent(true); return; }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setLanguagePresent(false); return; }
    // Keep the menu and native window space until its 160ms exit has finished.
    const timer = window.setTimeout(() => setLanguagePresent(false), 180);
    return () => window.clearTimeout(timer);
  }, [languageOpen]);
  const languageVisible = languageOpen || languagePresent;
  const [dock, setDock] = useState<DockState>(DEFAULT_DOCK);
  useEffect(() => {
    let active = true, received = false, wasDragging = false;
    const update = (next: DockState) => {
      if (!active) return;
      received = true; setDock(next);
      if (wasDragging && !next.dragging) { drag.current = false; setExpanded(false); }
      wasDragging = next.dragging;
    };
    const unsubscribe = window.sargosh?.onOverlayDock?.(update);
    void window.sargosh?.overlayDockState?.().then(next => { if (!received) update(next); }).catch(() => {});
    return () => { active = false; unsubscribe?.(); };
  }, []);
  const [state, setState] = useState<WindowsState>(INITIAL_WINDOWS_STATE);
  const [audio, setAudio] = useState<RecordingState>(INITIAL_RECORDING_STATE);
  const [speech, setSpeech] = useState<TranscriptionStatus>({ phase: 'idle', message: '' });
  const [allowanceClock,setAllowanceClock]=useState(()=>Date.now());
  const [dismissedAllowance,setDismissedAllowance]=useState<string|null>(null);
  const [allowance, setAllowance] = useState<OverlayNotice|null>(null);
  useEffect(()=>{
    let alive=true,received=false;
    const release=window.sargosh?.onAllowanceWarning?.(value=>{received=true;if(alive)setAllowance(value);});
    void window.sargosh?.allowanceWarning?.().then(value=>{if(alive&&!received)setAllowance(value);}).catch(()=>{});
    return()=>{alive=false;release?.();};
  },[]);
  const allowanceBlocked=Boolean(allowance?.id.split('|').some(id=>id.endsWith(':reached')&&Date.parse(id.match(/\d{4}-\d{2}-\d{2}T[^|]+?(?=:reached)/)?.[0]??'')>allowanceClock));
  useEffect(()=>{
    const resets=(allowance?.id.match(/\d{4}-\d{2}-\d{2}T[^|]+?(?=:reached)/g)??[]).map(Date.parse).filter(time=>time>Date.now());
    if(!resets.length)return;
    const timer=window.setTimeout(()=>setAllowanceClock(Date.now()),Math.min(2147483647,Math.min(...resets)-Date.now()+1));
    return()=>window.clearTimeout(timer);
  },[allowance?.id,allowanceClock]);
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState<string | null>(null);
  const noticeElement = useRef<HTMLDivElement>(null);
  useEffect(() => { setError(''); }, [audio.sessionId]);
  const drag = useRef(false);
  const stopDrag = () => { drag.current = false; void window.sargosh?.overlayDrag?.('stop').catch(() => {}); };
  useEffect(() => () => { void window.sargosh?.overlayDrag?.('stop').catch(() => {}); }, []);
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
  useEffect(() => { if (active || audioActive || cloudActive || dock.dragging) setLanguageOpen(false); }, [active, audioActive, cloudActive, dock.dragging]);
  const primaryNotice=recordingNotice(audio,speech);
  const idleAllowance=!active&&!audioActive&&!cloudActive&&allowance?.id!==dismissedAllowance?allowance:null;
  const attemptedAllowance=idleAllowance?.id.startsWith('allowance:attempt:')?idleAllowance:null;
  const notice = error ? { id: 'control:' + error, kind: 'error' as const, title: 'Control unavailable', message: error } : attemptedAllowance??primaryNotice??idleAllowance;
  const visibleNotice = notice && notice.id !== dismissed ? notice : null;
  useEffect(() => { if (!notice) setDismissed(null); }, [notice?.id]);
  useEffect(() => {
    const element = noticeElement.current;
    const resize = () => { void window.sargosh?.resizeOverlay?.(Math.max(languageVisible ? 230 : 120, element ? Math.min(400, Math.ceil(element.getBoundingClientRect().height + 80)) : 120)).catch(() => {}); };
    resize();
    if (!element) return;
    const observer = new ResizeObserver(resize); observer.observe(element);
    return () => observer.disconnect();
  }, [visibleNotice?.id, dock.position, languageVisible]);
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
  return <div className="overlay-stage" data-dock={dock.position} data-dragging={dock.dragging}>
    {visibleNotice && <div ref={noticeElement} className="overlay-notice-wrap" inert={languageVisible} aria-hidden={languageVisible} style={{ visibility: languageVisible ? 'hidden' : undefined }}><NoticeCard key={visibleNotice.id} notice={visibleNotice} onDismiss={() => { setDismissed(visibleNotice.id); setError(''); if(visibleNotice.id===allowance?.id)setDismissedAllowance(visibleNotice.id);  }} /></div>}
    <div className={(expanded || languageVisible || active || audioActive || cloudActive ? 'overlay-pill expanded' : 'overlay-pill') + (audioActive || cloudActive ? ' recording-active' : active ? ' input-test-active' : '')} onMouseEnter={() => setExpanded(true)} onMouseLeave={() => { if (!drag.current) setExpanded(false); }}>
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
      </> : expanded || languageVisible ? <>
        <button className="overlay-grip" aria-label="Move dictation control" data-tooltip={languageVisible ? '' : 'Drag to move'} onPointerDown={event => {
          if (event.button !== 0) return;
          const pill = event.currentTarget.closest('.overlay-pill')?.getBoundingClientRect();
          if (!pill || !window.sargosh?.overlayDrag) return;
          event.preventDefault(); drag.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          void window.sargosh.overlayDrag('start', { x: pill.x, y: pill.y, width: pill.width, height: pill.height }, window.matchMedia('(prefers-reduced-motion: reduce)').matches).catch(stopDrag);
        }} onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={stopDrag}><GripVertical size={15} /></button>
        <span className="overlay-mic-hint" data-tooltip-tone={allowanceBlocked && state.purpose==='recording' ? 'danger' : undefined} data-tooltip={languageVisible ? '' : allowanceBlocked && state.purpose==='recording' ? 'Allowance exhausted. View Usage in Sargosh.' : ''}><button className="overlay-mic" disabled={allowanceBlocked && state.purpose==='recording'} aria-label={allowanceBlocked && state.purpose==='recording' ? 'Allowance reached' : state.enabled ? state.purpose === 'recording' ? 'Start hands-free recording' : 'Start hands-free input test' : 'Open Sargosh to set up dictation'} data-tooltip={languageVisible ? '' : allowanceBlocked && state.purpose==='recording' ? 'Allowance exhausted. View Usage in Sargosh.' : state.enabled ? (state.purpose === 'recording' ? 'Dictate - ' : 'Input test - ') + shortcutLabel(state.shortcut) : 'Set up dictation in Sargosh'} onClick={() => state.enabled ? void action('start-hands-free') : void window.sargosh?.openMain()}><Mic size={19} /></button></span>
        {state.enabled && <OverlayLanguage open={languageOpen} onOpen={changeLanguageOpen} onError={message => { setError(message); setLanguageOpen(false); }} />}
      </> : <span className="idle-line" aria-hidden="true" />}
    </div>
  </div>;
}

export function NoticeCard({ notice, onDismiss }: { notice: OverlayNotice; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { dismiss.current(); return; }
    setClosing(true);
    closeTimer.current = window.setTimeout(() => dismiss.current(), 180);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(close, 5000);
    return () => { window.clearTimeout(timer); window.clearTimeout(closeTimer.current); };
  }, [notice.id, close]);
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
  return <section className="overlay-notice" data-closing={closing} role={notice.kind === 'info' ? 'status' : 'alert'} aria-label={notice.title}>
    <header>{notice.kind !== 'info' && <span className={'overlay-notice-icon ' + notice.kind}><AlertCircle size={16} /></span>}<strong>{notice.title}</strong><button className="overlay-notice-close" aria-label="Dismiss notification" data-tooltip="" onClick={close}><svg key={notice.id} className="overlay-notice-countdown" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12" pathLength="1" /></svg><X size={17} /></button></header>
    <p>{notice.message}</p>
    {notice.text && <div className="overlay-recovery-text" tabIndex={0} aria-label="Recovered dictation">{notice.text}</div>}
    <div className="overlay-notice-actions">
      {notice.text ? <button onClick={() => void copy()}><Copy size={13} />{copied ? 'Copied' : 'Copy text'}</button> : notice.kind === 'error' && <button onClick={() => void openHelp()}>{/microphone|recording|speech/i.test(notice.title) ? 'Microphone settings' : 'Open Sargosh'}</button>}
      {copyError && <span role="status">{copyError}</span>}
    </div>
  </section>;
}

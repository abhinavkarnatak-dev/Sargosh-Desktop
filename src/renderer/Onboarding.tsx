import { useMicrophones } from './useMicrophones';
import { SidebarLogo } from './SidebarLogo';
import { shortcutLabel } from '../shared/shortcut-label';
import { useEffect, useRef, useState } from 'react';
import { Mic, Square, X } from 'lucide-react';
import { useModalDialog } from './modal';
import { MicrophoneTest } from './MicrophoneTest';
import { ShortcutEditor } from './ShortcutEditor';
import { ThemedSelect } from './ThemedSelect';
import { activateShortcuts } from './activate-shortcuts';
import { recordingBusy } from '../shared/recording';
import { STT_LANGUAGES, isSpeechLanguage } from '../shared/transcription';
import type { Preferences } from '../shared/types';
import { cancelRecording, cloudBusy, finishRecording, recording, setTutorialMode, startRecording, transcription, useCleanup, useRecording, useTranscription } from './audio/runtime';
const EXAMPLE = 'With Sargosh, I can turn my thoughts into text.';
export function Onboarding({ preferences, onSave }: { preferences: Preferences; onSave(update: Partial<Preferences>): Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false);
  const exit = useRef<{ timer: ReturnType<typeof setTimeout>; resolve(value: boolean): void } | null>(null);
  useEffect(() => () => {
    if (exit.current) { clearTimeout(exit.current.timer); exit.current.resolve(false); exit.current = null; }
  }, []);
  const [devices, setDevices] = useMicrophones();
  const audio = useRecording(), speech = useTranscription(), clean = useCleanup();
  const listening = recordingBusy(audio), processing = speech.phase === 'working' || clean.phase === 'working' || cloudBusy();
  const blocked = busy || closing || listening || processing;
  const stoppedPractice = useRef<string | null>(null);
  useEffect(() => {
    // Leave room for the final audio chunk below the server's 20-second ceiling.
    if (step === 2 && audio.phase === 'recording' && audio.durationMs >= 18000 && audio.sessionId !== stoppedPractice.current) {
      stoppedPractice.current = audio.sessionId; void finishRecording();
    }
  }, [step, audio.phase, audio.durationMs, audio.sessionId]);
  useModalDialog(dialog);
  useEffect(() => {
    setTutorialMode(true);
    return () => { cancelRecording(); recording.clear(); setTutorialMode(false); };
  }, []);
  useEffect(() => {
    if (step === 2 || !window.sargosh?.windowsStatus) return;
    let alive = true;
    void window.sargosh.windowsStatus().then(state => {
      if (alive && state.enabled && state.purpose === 'recording') return window.sargosh!.windowsAction('disarm');
    }).catch(() => {});
    return () => { alive = false; };
  }, [step]);
  async function next() {
    if (blocked || editing) return;
    setBusy(true); setError('');
    try {
      if (step === 1 || step === 2) await activateShortcuts(preferences.shortcut);
      if (step === 2) {
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          setClosing(true);
          const finished = await new Promise<boolean>(resolve => {
            exit.current = { resolve, timer: setTimeout(() => { exit.current = null; resolve(true); }, 180) };
          });
          if (!finished) return;
        }
        await window.sargosh!.completeOnboarding();
      }
      else setStep(value => value + 1);
    } catch (failure) { setClosing(false); setError(failure instanceof Error ? failure.message : 'Setup could not continue. Please try again.'); }
    finally { setBusy(false); }
  }
  const result = clean.phase === 'completed' && clean.sessionId === speech.sessionId ? clean.result?.text : '';
  return <dialog ref={dialog} className="onboarding-dialog animated-modal" data-closing={closing} aria-labelledby="onboarding-title" onCancel={event => event.preventDefault()}>
    <div className="onboarding-header"><SidebarLogo /><span>LET’S GET YOU SET UP</span></div>
    <ol className="onboarding-steps" aria-label="Setup progress">{['Microphone', 'Shortcut', 'Try dictation'].map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined} className={index <= step ? 'reached' : ''}><span>{index + 1}</span>{label}</li>)}</ol>
    <div className="onboarding-body" key={step}>
      <h2 id="onboarding-title">{['Let us hear you.', 'Choose your shortcut.', 'Your first words with Sargosh.'][step]}</h2>
      {step === 0 ? <><p className="subtitle">Choose a microphone, then speak to check the level. This test stays on your computer.</p><ThemedSelect label="Microphone" value={preferences.microphoneId} placeholder="Unavailable microphone" options={[{value:'default',label:'Windows default'}, ...devices.filter(device => device.deviceId && !['default','communications'].includes(device.deviceId)).map((device,index) => ({value:device.deviceId,label:device.label || 'Microphone '+(index+1)}))]} onChange={value => void onSave({microphoneId:value})}/><MicrophoneTest microphoneId={preferences.microphoneId} onDevices={setDevices}/></> : step === 1 ? <><p className="subtitle">Keep the suggested shortcut or choose one that feels comfortable. You can change it later in Settings.</p><ShortcutEditor shortcut={preferences.shortcut} onSave={value => onSave({shortcut:value})} onEditingChange={setEditing}/><p className="inline-help">Hold to talk and release to finish. Double-tap to start hands-free, then double-tap again to finish.</p></> : <>
        <p className="subtitle">Try saying this, or use your own words:</p><blockquote className="onboarding-example">{EXAMPLE}</blockquote>
        <ThemedSelect label="Speech language" value={speech.language} options={STT_LANGUAGES} disabled={blocked} onChange={value => { if(isSpeechLanguage(value)) transcription.configure({language:value}); }}/>
        <p className="inline-help">Hold {shortcutLabel(preferences.shortcut)} and speak, or use the button below. Your practice text stays in this modal instead of being typed into another app.</p>
        <div className="onboarding-recording-actions">{listening ? <><button className="button" disabled={audio.phase === 'finishing'} onClick={() => void finishRecording()}><Square size={14}/>Finish</button><button className="button secondary" onClick={cancelRecording}><X size={14}/>Cancel</button></> : <button className="button" disabled={blocked} onClick={() => { setError(''); void startRecording().catch(() => setError('Could not start recording. Check your microphone and try again.')); }}><Mic size={15}/>{result ? 'Try again' : 'Start recording'}</button>}</div>
        {listening && <div className="meter" role="meter" aria-label="Recording microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={audio.level}><span style={{width:audio.level+'%'}}/></div>}
        {processing && !listening && <p className="inline-help" role="status">Preparing your text...</p>}
        {speech.phase === 'completed' && speech.result && !speech.result.text.trim() && <p className="inline-help" role="status">No speech was detected. Check your microphone and try again.</p>}
        {result && <label className="onboarding-result">Your practice transcript<textarea readOnly value={result} rows={3}/></label>}
        {(audio.phase === 'failed' || speech.phase === 'failed' || clean.phase === 'failed') && <p role="alert" className="error-message">{audio.phase === 'failed' ? audio.message : speech.phase === 'failed' ? speech.message : clean.message}</p>}
        <p className="onboarding-cloud-note">Practice is separate: three attempts of up to 20 seconds, with no deduction from your dictation allowance or contribution to history and Insights.</p>
      </>}
    </div>
    {error && <p className="error-message" role="alert">{error}</p>}
    <footer className="onboarding-footer"><span>Step {step+1} of 3</span><div>{step === 1 && <button className="button secondary" disabled={blocked || editing} onClick={() => { setError(''); setStep(value => value-1); }}>Back</button>}<button className="button" disabled={blocked || editing} onClick={() => void next()}>{busy ? 'Please wait...' : step === 2 ? 'Finish setup' : 'Continue'}</button></div></footer>
  </dialog>;
}

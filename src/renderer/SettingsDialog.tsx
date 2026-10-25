import { ThemedSelect } from './ThemedSelect';
import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Info, Monitor, Moon, Settings, Sun, User, X } from 'lucide-react';
import type { Preferences, Theme } from '../shared/types';
import { STT_LANGUAGES, isSpeechLanguage } from '../shared/transcription';
import { transcription, useCleanup, useTranscription, useRecording } from './audio/runtime';
import { recordingBusy } from '../shared/recording';
import { MicrophoneTest } from './MicrophoneTest';
import { WindowsTestPanel } from './WindowsTestPanel';
export function SettingsDialog({ preferences, onSave, onClose }: { preferences: Preferences; onSave(update: Partial<Preferences>): Promise<void>; onClose(): void }) {
  const recordingState = useRecording();
  const speech = useTranscription();
  const clean = useCleanup();
  const [tab, setTab] = useState<'general' | 'account'>('general');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [details, setDetails] = useState<'shortcuts' | 'languages' | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const outsidePress = useRef(false);
  function outside(element: HTMLDialogElement, x: number, y: number) {
    const bounds = element.getBoundingClientRect();
    return x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom;
  }
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // showModal supplies the focus trap and makes the background inert.
    element.showModal();
    const scrollingElements = [document.documentElement, document.body];
    const previous = scrollingElements.map(node => ({ node, value: node.style.getPropertyValue('overflow'), priority: node.style.getPropertyPriority('overflow') }));
    scrollingElements.forEach(node => node.style.setProperty('overflow', 'hidden', 'important'));
    void navigator.mediaDevices?.enumerateDevices().then(items => setDevices(items.filter(item => item.kind === 'audioinput'))).catch(() => {});
    return () => {
      element.close();
      for (const { node, value, priority } of previous) {
        if (value) node.style.setProperty('overflow', value, priority);
        else node.style.removeProperty('overflow');
      }
    };
  }, []);
  return <dialog ref={dialog} className="settings-dialog" onCancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="settings-title" onPointerDown={event => {
    outsidePress.current = event.target === event.currentTarget && outside(event.currentTarget, event.clientX, event.clientY);
  }} onClick={event => {
    const dismiss = outsidePress.current && event.target === event.currentTarget && outside(event.currentTarget, event.clientX, event.clientY);
    outsidePress.current = false;
    if (dismiss) onClose();
  }}>
    <div className="settings-layout"><aside className="settings-sidebar"><p className="eyebrow" id="settings-title">SETTINGS</p><button className={tab === 'general' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('general')}><Settings size={17} />General</button><p className="eyebrow settings-group">ACCOUNT</p><button className={tab === 'account' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('account')}><User size={17} />Account</button><span className="settings-version">Sargosh 0.1.0</span></aside>
    <div className="settings-content"><button className="icon-button close-dialog" aria-label="Close settings" onClick={onClose}><X size={20} /></button>
      {tab === 'general' ? <>
        <p className="eyebrow">MAKE IT YOURS</p><h2>General</h2><p className="subtitle">A few preferences for a more comfortable flow.</p>
        <div className="settings-card">
          <div className="setting-row"><div><strong>Shortcuts</strong><p>Hold to talk or double-tap for hands-free.</p></div><button className="button secondary" onClick={() => setDetails(details === 'shortcuts' ? null : 'shortcuts')}>View<ChevronRight size={14} /></button></div>
          {details === 'shortcuts' && <WindowsTestPanel shortcut={preferences.shortcut} onShortcut={value => onSave({ shortcut: value })} />}
          <div className="setting-row"><div><strong>Microphone</strong><p>Choose the input Sargosh should use.</p></div><ThemedSelect label="Microphone" value={preferences.microphoneId} placeholder="Unavailable microphone" options={[{ value: 'default', label: 'Windows default' }, ...devices.filter(device => device.deviceId !== 'default' && device.deviceId !== 'communications' && device.deviceId).map((device, index) => ({ value: device.deviceId, label: device.label || 'Microphone ' + (index + 1) }))]} onChange={value => void onSave({ microphoneId: value })} /></div>
          <div className="setting-row"><div><strong>My languages</strong><p>Languages used for speech recognition.</p></div><button className="button secondary" onClick={() => setDetails(details === 'languages' ? null : 'languages')}>View<ChevronRight size={14} /></button></div>
          {details === 'languages' && <div className="inline-detail"><Info size={16} /><div><label htmlFor="settings-speech-language">Deepgram speech language</label><ThemedSelect id="settings-speech-language" value={speech.language} disabled={recordingBusy(recordingState) || speech.phase === 'working' || clean.phase === 'working'} options={STT_LANGUAGES} onChange={value => { if (isSpeechLanguage(value)) transcription.configure({ language: value }); }} /><p>Mixed speech uses Nova-3 multilingual. This does not translate or romanize the transcript.</p></div></div>}
          <div className="setting-row"><div><strong>Theme</strong><p>Choose how Sargosh looks.</p></div><div className="theme-picker" role="group" aria-label="Theme">{([{ value: 'system', Icon: Monitor, label: 'System' }, { value: 'light', Icon: Sun, label: 'Light' }, { value: 'dark', Icon: Moon, label: 'Dark' }] as const).map(({ value, Icon, label }) => <button key={value} className={preferences.theme === value ? 'selected' : ''} aria-pressed={preferences.theme === value} onClick={() => void onSave({ theme: value as Theme })}><Icon size={15} />{label}</button>)}</div></div>
        </div>
        <MicrophoneTest disabled={recordingBusy(recordingState)} microphoneId={preferences.microphoneId} onDevices={setDevices} />
      </> : <>
        <p className="eyebrow">YOUR SPACE</p><h2>Account</h2><p className="subtitle">Your profile and sign-in preferences.</p>
        <div className="account-placeholder"><div className="avatar"><User size={28} strokeWidth={1.5} /></div><h3>Your account belongs here.</h3><p>Google sign-in and email verification will be connected through Supabase. No account is signed in in this development build.</p><button className="button" disabled>Continue with Google</button><button className="button secondary" disabled>Continue with email</button></div>
        <p className="privacy-footnote">Recordings and transcripts stay on this computer. Account and usage services are separate from your local history.</p>
      </>}
    </div></div>
  </dialog>;
}

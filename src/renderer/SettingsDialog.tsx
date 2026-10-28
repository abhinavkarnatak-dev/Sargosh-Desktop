import { SettingsDetail } from './SettingsDetail';
import { version } from '../../package.json';
import { useMicrophones } from './useMicrophones';
import { shortcutLabel } from '../shared/shortcut-label';
import { AccountPanel } from './AccountPanel';
import { useModalDialog, useModalDismiss } from './modal';
import { ThemedSelect } from './ThemedSelect';
import { useRef, useState } from 'react';
import { ChevronRight, Info, Monitor, Moon, Settings, Sun, User, X } from 'lucide-react';
import type { Preferences, Theme } from '../shared/types';
import { STT_LANGUAGES, isSpeechLanguage } from '../shared/transcription';
import { transcription, useCleanup, useTranscription, useRecording } from './audio/runtime';
import { recordingBusy } from '../shared/recording';
import { MicrophoneTest } from './MicrophoneTest';
import { ShortcutEditor } from './ShortcutEditor';
export function SettingsDialog({ preferences, onSave, onClose: onDismissed }: { preferences: Preferences; onSave(update: Partial<Preferences>): Promise<void>; onClose(): void }) {
  const {closing,dismiss:onClose}=useModalDismiss(onDismissed);
  const recordingState = useRecording();
  const speech = useTranscription();
  const clean = useCleanup();
  const [tab, setTab] = useState<'general' | 'account'>('general');
  const [devices, setDevices] = useMicrophones();
  const [details, setDetails] = useState<'shortcuts' | 'languages' | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const outsidePress = useRef(false);
  function outside(element: HTMLDialogElement, x: number, y: number) {
    const bounds = element.getBoundingClientRect();
    return x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom;
  }
  useModalDialog(dialog);
  return <dialog ref={dialog} className="settings-dialog animated-modal" data-closing={closing} onCancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="settings-title" onPointerDown={event => {
    outsidePress.current = event.target === event.currentTarget && outside(event.currentTarget, event.clientX, event.clientY);
  }} onClick={event => {
    const dismiss = outsidePress.current && event.target === event.currentTarget && outside(event.currentTarget, event.clientX, event.clientY);
    outsidePress.current = false;
    if (dismiss) onClose();
  }}>
    <div className="settings-layout"><aside className="settings-sidebar"><p className="eyebrow" id="settings-title">SETTINGS</p><button className={tab === 'general' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('general')}><Settings size={17} />General</button><p className="eyebrow settings-group">ACCOUNT</p><button className={tab === 'account' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('account')}><User size={17} />Account</button><span className="settings-version">Sargosh {version}</span></aside>
    <div className="settings-content"><button className="icon-button close-dialog" aria-label="Close settings" onClick={onClose}><X size={20} /></button>
      {tab === 'general' ? <>
        <p className="eyebrow">MAKE IT YOURS</p><h2>General</h2><p className="subtitle">A few preferences for a more comfortable flow.</p>
        <div className="settings-card">
          <div className="setting-row"><div><strong>Shortcuts</strong><p>{shortcutLabel(preferences.shortcut)}</p></div><button className="button secondary" aria-expanded={details === 'shortcuts'} aria-controls="settings-shortcuts" onClick={() => setDetails(details === 'shortcuts' ? null : 'shortcuts')}>View<ChevronRight size={14} /></button></div>
          <SettingsDetail open={details === 'shortcuts'} id="settings-shortcuts"><ShortcutEditor shortcut={preferences.shortcut} onSave={value => onSave({ shortcut: value })} /></SettingsDetail>
          <div className="setting-row"><div><strong>Microphone</strong><p>Choose the input Sargosh should use.</p></div><ThemedSelect label="Microphone" value={preferences.microphoneId} placeholder="Unavailable microphone" options={[{ value: 'default', label: 'Windows default' }, ...devices.filter(device => device.deviceId !== 'default' && device.deviceId !== 'communications' && device.deviceId).map((device, index) => ({ value: device.deviceId, label: device.label || 'Microphone ' + (index + 1) }))]} onChange={value => void onSave({ microphoneId: value })} /></div>
          <div className="setting-row"><div><strong>My languages</strong><p>Languages used for speech recognition.</p></div><button className="button secondary" aria-expanded={details === 'languages'} aria-controls="settings-languages" onClick={() => setDetails(details === 'languages' ? null : 'languages')}>View<ChevronRight size={14} /></button></div>
          <SettingsDetail open={details === 'languages'} id="settings-languages"><div className="inline-detail"><Info size={16} /><div><label htmlFor="settings-speech-language">Deepgram speech language</label><ThemedSelect id="settings-speech-language" value={speech.language} disabled={recordingBusy(recordingState) || speech.phase === 'working' || clean.phase === 'working'} options={STT_LANGUAGES} onChange={value => { if (isSpeechLanguage(value)) transcription.configure({ language: value }); }} /><p>Hinglish uses multilingual recognition. With cleanup enabled, Hindi is written in Roman letters while English stays English. Hindi mode preserves the original script.</p></div></div></SettingsDetail>
          <div className="setting-row"><div><strong>Theme</strong><p>Choose how Sargosh looks.</p></div><div className="theme-picker" role="group" aria-label="Theme">{([{ value: 'system', Icon: Monitor, label: 'System' }, { value: 'dark', Icon: Moon, label: 'Dark' }, { value: 'light', Icon: Sun, label: 'Light' }] as const).map(({ value, Icon, label }) => <button key={value} className={preferences.theme === value ? 'selected' : ''} aria-pressed={preferences.theme === value} onClick={() => void onSave({ theme: value as Theme })}><Icon size={15} />{label}</button>)}</div></div>
        </div>
        <MicrophoneTest disabled={recordingBusy(recordingState)} microphoneId={preferences.microphoneId} onDevices={setDevices} />
      </> : <>
        <p className="eyebrow">YOUR SPACE</p><h2>Account</h2><p className="subtitle">Your profile and sign-in preferences.</p>
        <AccountPanel />
      </>}
    </div></div>
  </dialog>;
}

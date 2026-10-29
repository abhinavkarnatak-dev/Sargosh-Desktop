import { isSpeechLanguage, type SpeechLanguage } from '../shared/transcription';

const key = 'sargosh.speech-language';
const changed = 'sargosh:speech-language';
export function readSpeechLanguage(): SpeechLanguage {
  try { const value = localStorage.getItem(key); return isSpeechLanguage(value) ? value : 'en'; }
  catch { return 'en'; }
}
export function saveSpeechLanguage(language: SpeechLanguage) {
  // The main renderer owns capture; the overlay only changes this shared setting.
  if (!isSpeechLanguage(language)) return;
  try { if (localStorage.getItem(key) !== language) localStorage.setItem(key, language); }
  catch { throw new Error('Could not save the language. Try again.'); }
  window.dispatchEvent(new Event(changed));
}
export function watchSpeechLanguage(update: (language: SpeechLanguage) => void) {
  const local = () => update(readSpeechLanguage());
  const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) local(); };
  window.addEventListener('storage', storage); window.addEventListener(changed, local);
  return () => { window.removeEventListener('storage', storage); window.removeEventListener(changed, local); };
}
interface LanguageOwner {
  getState(): { language: SpeechLanguage };
  configure(value: { language: SpeechLanguage }): void;
  subscribe(listener: () => void): () => void;
}
export function syncSpeechLanguage(owner: LanguageOwner, busy: () => boolean) {
  owner.configure({ language: readSpeechLanguage() });
  const remember = () => {
    try { if (readSpeechLanguage() !== owner.getState().language) saveSpeechLanguage(owner.getState().language); }
    catch { /* Storage failure must never interrupt recording or processing. */ }
  };
  const unwatch = watchSpeechLanguage(language => {
    if (language === owner.getState().language) return;
    if (busy()) { remember(); return; }
    owner.configure({ language });
  });
  const unsubscribe = owner.subscribe(remember);
  return () => { unwatch(); unsubscribe(); };
}

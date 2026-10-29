import { useEffect, useId, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { STT_LANGUAGES, type SpeechLanguage } from '../shared/transcription';
import { readSpeechLanguage, saveSpeechLanguage, watchSpeechLanguage } from './speech-language';

const marks: Record<SpeechLanguage, string> = { en: 'A', hi: 'अ', multi: 'Aअ' };
export function OverlayLanguage({ open, onOpen, onError }: { open: boolean; onOpen(open: boolean): void; onError(message: string): void }) {
  const [language, setLanguage] = useState(readSpeechLanguage);
  const container = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => watchSpeechLanguage(setLanguage), []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) onOpen(false); };
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onOpen(false); } };
    const release = window.sargosh?.onOverlayOutsidePress?.(() => onOpen(false));
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', keyboard);
    return () => { release?.(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', keyboard); };
  }, [open, onOpen]);
  const label = STT_LANGUAGES.find(option => option.value === language)!.label;
  return <div className="overlay-language" ref={container}>
    <button className="overlay-language-trigger" type="button" aria-label={'Speech language: ' + label} aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} data-tooltip={open ? '' : 'Speech language: ' + label} onClick={() => onOpen(!open)}>{marks[language]}</button>
    <div className="overlay-language-menu" id={menuId} data-open={open} inert={!open} aria-hidden={!open} role="menu" aria-label="Speech language" onKeyDown={event => {
      if (event.key === 'Tab') onOpen(false);
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>
      {STT_LANGUAGES.map(option => <button key={option.value} type="button" role="menuitemradio" aria-checked={language === option.value} onClick={() => {
        try { saveSpeechLanguage(option.value); setLanguage(option.value); onOpen(false); }
        catch (error) { onError(error instanceof Error ? error.message : 'Could not change the language.'); }
      }}><span className="overlay-language-mark" aria-hidden="true">{marks[option.value]}</span><span>{option.label}</span>{language === option.value && <Check size={14} aria-hidden="true" />}</button>)}
    </div>
  </div>;
}

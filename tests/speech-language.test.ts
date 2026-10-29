// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { readSpeechLanguage, saveSpeechLanguage, syncSpeechLanguage } from '../src/renderer/speech-language';
import { TranscriptionController } from '../src/renderer/audio/transcription';
import type { SpeechLanguage } from '../src/shared/transcription';

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
it('shares changes between the overlay setting and the actual transcription owner, preserving all three modes', () => {
  const owner = new TranscriptionController(async () => { throw new Error('No provider calls expected'); });
  saveSpeechLanguage('hi');
  const stop = syncSpeechLanguage(owner, () => false);
  try {
    expect(owner.getState().language).toBe('hi');
    for (const language of ['en', 'multi', 'hi'] as SpeechLanguage[]) {
      saveSpeechLanguage(language); expect(owner.getState().language).toBe(language);
    }
    // Settings still configures the existing controller; the overlay sees that choice.
    owner.configure({ language: 'multi' }); expect(readSpeechLanguage()).toBe('multi');
    const restarted = new TranscriptionController(async () => { throw new Error('No provider calls expected'); });
    const release = syncSpeechLanguage(restarted, () => false);
    expect(restarted.getState().language).toBe('multi'); release();
  } finally { stop(); }
});
it('receives other-window storage events and refuses a language switch during recording or processing', () => {
  let busy = false;
  const owner = new TranscriptionController(async () => { throw new Error('No provider calls expected'); });
  const stop = syncSpeechLanguage(owner, () => busy);
  const otherWindow = (value: string) => { localStorage.setItem('sargosh.speech-language', value); window.dispatchEvent(new StorageEvent('storage', { key: 'sargosh.speech-language', newValue: value })); };
  try {
    otherWindow('hi'); expect(owner.getState().language).toBe('hi');
    busy = true; otherWindow('multi'); expect(owner.getState().language).toBe('hi'); expect(readSpeechLanguage()).toBe('hi');
    busy = false; otherWindow('multi'); expect(owner.getState().language).toBe('multi');
  } finally { stop(); }
  otherWindow('en'); expect(owner.getState().language).toBe('multi');
});
it('does not interrupt the transcription owner if browser preference storage is unavailable', () => {
  const owner = new TranscriptionController(async () => { throw new Error('No provider calls expected'); });
  const stop = syncSpeechLanguage(owner, () => false);
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
  try {
    expect(() => owner.configure({ language: 'hi' })).not.toThrow();
    expect(owner.getState().language).toBe('hi');
    expect(() => saveSpeechLanguage('multi')).toThrow('Could not save the language.');
  } finally { stop(); }
});

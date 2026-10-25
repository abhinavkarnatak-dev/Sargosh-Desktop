import { randomUUID } from 'node:crypto';
import type { LocalHistory } from './history';
import type { DesktopTranscriber } from './transcription';
export async function retrySavedTranscript(id: string, history: Pick<LocalHistory, 'get' | 'audio' | 'update'>, transcriber: Pick<DesktopTranscriber, 'transcribe' | 'cleanup'>) {
  const entry = await history.get(id); if (!entry) throw new Error('Recording is unavailable.');
  let originalText = '';
  try {
    const clip = await history.audio(id); const language = entry.language ?? 'en';
    const speech = await transcriber.transcribe({ requestId: randomUUID(), audio: clip.audio, mimeType: clip.mimeType, language });
    if (!speech.ok) throw new Error(speech.message);
    originalText = speech.result.text; if (!originalText.trim()) throw new Error('No speech was recognized.');
    let text = originalText;
    if (entry.cleanupEnabled !== false) {
      const cleaned = await transcriber.cleanup({ requestId: randomUUID(), text, language });
      if (!cleaned.ok) throw new Error(cleaned.message);
      text = cleaned.result.text;
    }
    await history.update({ id, text, originalText, language, cleanupEnabled: entry.cleanupEnabled !== false, status: 'completed' });
  } catch (error) {
    if (entry.status !== 'completed') await history.update({ id, text: originalText, originalText, language: entry.language ?? 'en', cleanupEnabled: entry.cleanupEnabled !== false, status: 'failed', error: 'Could not prepare the transcript. Try again.' });
    throw error;
  }
}

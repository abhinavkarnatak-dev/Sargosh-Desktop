import { randomUUID } from 'node:crypto';
import type { LocalHistory } from './history';
import type { DesktopTranscriber } from './transcription';
export async function retrySavedTranscript(id: string, history: Pick<LocalHistory, 'get' | 'audio' | 'update'>, transcriber: Pick<DesktopTranscriber, 'transcribe' | 'cleanup'>) {
  const entry = await history.get(id); if (!entry) throw new Error('Recording is unavailable.');
  let originalText = entry.status === 'failed' && entry.cleanupEnabled !== false ? entry.originalText ?? '' : '';
  let failureMessage = 'Could not prepare the transcript. Try again.';
  const traceId = randomUUID();
  try {
    const language = entry.language ?? 'en';
    let text: string;
    if (originalText.trim()) {
      // Transcription already succeeded. Retrying cleanup must not upload the
      // recording again or consume another audio allowance.
      const cleaned = await transcriber.cleanup({ traceId, requestId: randomUUID(), text: originalText, language });
      if (!cleaned.ok) { failureMessage = cleaned.message; throw new Error(cleaned.message); }
      text = cleaned.result.text;
    } else {
      const clip = await history.audio(id);
      const speech = await transcriber.transcribe({ traceId, requestId: randomUUID(), audio: clip.audio, mimeType: clip.mimeType, language, cleanup: entry.cleanupEnabled !== false });
      if (!speech.ok) { failureMessage = speech.message; throw new Error(speech.message); }
      originalText = speech.result.text; if (!originalText.trim()) throw new Error('No speech was recognized.');
      text = originalText;
      if (entry.cleanupEnabled !== false) {
        const cleaned = speech.result.cleanup ?? await transcriber.cleanup({ traceId, requestId: randomUUID(), text, language });
        if (!cleaned.ok) { failureMessage = cleaned.message; throw new Error(cleaned.message); }
        text = cleaned.result.text;
      }
    }
    await history.update({ id, text, originalText, language, cleanupEnabled: entry.cleanupEnabled !== false, status: 'completed' });
  } catch (error) {
    if (entry.status !== 'completed') await history.update({ id, text: originalText, originalText, language: entry.language ?? 'en', cleanupEnabled: entry.cleanupEnabled !== false, status: 'failed', error: failureMessage });
    throw error;
  }
}

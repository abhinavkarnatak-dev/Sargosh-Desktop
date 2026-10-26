import { practiceSession } from './practice';
import { transcribeViaLocalAPI } from '../../shared/local-api';
import type { TranscriptionTransport } from './transcription';
export const transcriptionTransport: TranscriptionTransport = async (blob, language, requestId, signal) => {
  const practiceId = practiceSession();
  if (practiceId) requestId = practiceId;
  const audio = await blob.arrayBuffer();
  if (signal.aborted) throw new Error('Transcription cancelled.');
  if (!window.sargosh) return transcribeViaLocalAPI({ ...(practiceId ? { practice: true } : {}), requestId, audio, mimeType: blob.type, language }, signal, '/api');
  const cancel = () => { void window.sargosh!.cancelTranscription(requestId).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) throw new Error('Transcription cancelled.');
    const send = practiceId ? window.sargosh.practiceTranscribeAudio : window.sargosh.transcribeAudio;
    if (!send) throw new Error('Restart Sargosh to use isolated practice dictation.');
    const reply = await send({ ...(practiceId ? { practice: true } : {}), requestId, audio, mimeType: blob.type, language });
    if (!reply.ok) throw new Error(reply.message);
    return reply.result;
  } finally { signal.removeEventListener('abort', cancel); }
};

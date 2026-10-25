import { transcribeViaLocalAPI } from '../../shared/local-api';
import type { TranscriptionTransport } from './transcription';
export const transcriptionTransport: TranscriptionTransport = async (blob, language, requestId, signal) => {
  const audio = await blob.arrayBuffer();
  if (signal.aborted) throw new Error('Transcription cancelled.');
  if (!window.sargosh) return transcribeViaLocalAPI({ requestId, audio, mimeType: blob.type, language }, signal, '/api');
  const cancel = () => { void window.sargosh!.cancelTranscription(requestId).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) throw new Error('Transcription cancelled.');
    const reply = await window.sargosh.transcribeAudio({ requestId, audio, mimeType: blob.type, language });
    if (!reply.ok) throw new Error(reply.message);
    return reply.result;
  } finally { signal.removeEventListener('abort', cancel); }
};

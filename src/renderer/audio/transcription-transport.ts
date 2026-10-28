import { practiceSession } from './practice';
import { transcribeViaLocalAPI } from '../../shared/local-api';
import type { TranscriptionTransport } from './transcription';
import { TimingTrace } from '../../shared/timing';
export const transcriptionTransport: TranscriptionTransport = async (blob, language, requestId, signal, traceId, cleanup = false) => {
  const practiceId = practiceSession();
  if (practiceId) requestId = practiceId;
  const timing = new TimingTrace(traceId ?? requestId, 'desktop', requestId);
  const audio = await timing.measure('audio.serialize', () => blob.arrayBuffer(), { bytes: blob.size }, signal);
  if (signal.aborted) throw new Error('Transcription cancelled.');
  if (!window.sargosh) return transcribeViaLocalAPI({ ...(traceId ? { traceId } : {}), ...(practiceId ? { practice: true } : {}), ...(cleanup ? { cleanup: true } : {}), requestId, audio, mimeType: blob.type, language }, signal, '/api');
  const cancel = () => { void window.sargosh!.cancelTranscription(requestId).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) throw new Error('Transcription cancelled.');
    const send = practiceId ? window.sargosh.practiceTranscribeAudio : window.sargosh.transcribeAudio;
    if (!send) throw new Error('Restart Sargosh to use isolated practice dictation.');
    const reply = await send({ ...(traceId ? { traceId } : {}), ...(practiceId ? { practice: true } : {}), ...(cleanup ? { cleanup: true } : {}), requestId, audio, mimeType: blob.type, language });
    if (!reply.ok) throw Object.assign(new Error(reply.message), { code: reply.code });
    return reply.result;
  } finally { signal.removeEventListener('abort', cancel); }
};

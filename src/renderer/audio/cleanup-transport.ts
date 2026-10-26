import { practiceSession } from './practice';
import { cleanupViaLocalAPI } from '../../shared/local-api';
import type { CleanupTransport } from './cleanup';
export const cleanupTransport: CleanupTransport = async (text, language, requestId, signal) => {
  const practiceId = practiceSession();
  if (practiceId) requestId = practiceId;
  if (signal.aborted) throw new Error('Cleanup cancelled.');
  if (!window.sargosh) return cleanupViaLocalAPI({ ...(practiceId ? { practice: true } : {}), requestId, text, language }, signal, '/api');
  const cancel = () => { void window.sargosh!.cancelTranscription(requestId).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) throw new Error('Cleanup cancelled.');
    const send = practiceId ? window.sargosh.practiceCleanupTranscript : window.sargosh.cleanupTranscript;
    if (!send) throw new Error('Restart Sargosh to use isolated practice dictation.');
    const reply = await send({ ...(practiceId ? { practice: true } : {}), requestId, text, language });
    if (!reply.ok) throw new Error(reply.message);
    return reply.result;
  } finally { signal.removeEventListener('abort', cancel); }
};

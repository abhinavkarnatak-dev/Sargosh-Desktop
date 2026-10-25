import { cleanupViaLocalAPI } from '../../shared/local-api';
import type { CleanupTransport } from './cleanup';
export const cleanupTransport: CleanupTransport = async (text, language, requestId, signal) => {
  if (signal.aborted) throw new Error('Cleanup cancelled.');
  if (!window.sargosh) return cleanupViaLocalAPI({ requestId, text, language }, signal, '/api');
  const cancel = () => { void window.sargosh!.cancelTranscription(requestId).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) throw new Error('Cleanup cancelled.');
    const reply = await window.sargosh.cleanupTranscript({ requestId, text, language });
    if (!reply.ok) throw new Error(reply.message);
    return reply.result;
  } finally { signal.removeEventListener('abort', cancel); }
};

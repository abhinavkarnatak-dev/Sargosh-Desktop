import { apiEndpoint,hostedEndpoint } from './api-endpoint';
import { audioType, isRequestId, isSpeechLanguage, type Transcript, type TranscriptionRequest } from './transcription';
import { MAX_CLEANUP_CHARS, isCleanupModel, type CleanupRequest, type CleanupResult } from './cleanup';
import { MAX_AUDIO_BYTES } from './recording';

export class LocalApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export async function transcribeViaLocalAPI(request: TranscriptionRequest, signal: AbortSignal, base = 'http://127.0.0.1:4318', fetcher: typeof fetch = fetch, accessToken?: string): Promise<Transcript> {
  if (!isRequestId(request.requestId) || !isSpeechLanguage(request.language) || !audioType(request.mimeType) || !request.audio.byteLength || request.audio.byteLength > MAX_AUDIO_BYTES) {
    throw new LocalApiError('INVALID_REQUEST', 'The recording cannot be sent for transcription.');
  }
  if(!base.startsWith('/'))base=apiEndpoint(base);
  const remote=hostedEndpoint(base);
  const deadline = AbortSignal.timeout(remote?180_000:75_000);
  const combined = AbortSignal.any([signal, deadline]);
  const read = async (response: Response) => {
    let data: unknown;
    try { data = await response.json(); } catch { throw new LocalApiError('LOCAL_API', 'The local API returned an unreadable response.'); }
    if (!response.ok) {
      const error = data as { code?: unknown; message?: unknown; resetAt?: unknown };
      throw new LocalApiError(typeof error.code === 'string' ? error.code : 'LOCAL_API',
        typeof error.message === 'string' && error.message.length <= 400 ? error.message+resetMessage(error.resetAt) : 'Transcription could not complete.');
    }
    return data;
  };
  try {
    const session = remote ? await warmHostedAPI(base,combined,fetcher,accessToken) : await read(await fetcher(base + '/v1/local-session', { signal: combined, cache: 'no-store', redirect: 'error' })) as { token?: unknown };
    if (!remote && (typeof session.token !== 'string' || !/^[a-f0-9]{64}$/.test(session.token))) throw new LocalApiError('LOCAL_SESSION', 'Could not open a local transcription session.');
    const result = await read(await fetcher(base + '/v1/transcriptions?language=' + request.language, {
      method: 'POST', signal: combined, redirect: 'error', headers: {
        ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}), 'Content-Type': request.mimeType, ...(!remote?{'x-sargosh-token': session.token as string}:{}), 'x-sargosh-request-id': request.requestId
      }, body: request.audio
    })) as Partial<Transcript>;
    if (typeof result.text !== 'string' || result.text.length > 100_000 || result.language !== request.language || result.model !== 'nova-3' ||
        typeof result.durationMs !== 'number' || !Number.isFinite(result.durationMs) || result.durationMs < 0 ||
        (result.confidence !== null && (typeof result.confidence !== 'number' || result.confidence < 0 || result.confidence > 1))) {
      throw new LocalApiError('LOCAL_API', 'The local API returned an unreadable transcript.');
    }
    return result as Transcript;
  } catch (error) {
    if (signal.aborted) throw new LocalApiError('CANCELLED', 'Transcription cancelled.');
    if (deadline.aborted) throw new LocalApiError('LOCAL_TIMEOUT', 'Transcription took too long. Cancelled locally; retry only after checking the connection.');
    if (error instanceof LocalApiError) throw error;
    throw new LocalApiError('LOCAL_CONNECTION', remote?'Could not reach the dictation service. Check your connection and try again.':'Could not reach the local transcription API. Check that it is running.');
  }
}

export async function cleanupViaLocalAPI(request: CleanupRequest, signal: AbortSignal, base = 'http://127.0.0.1:4318', fetcher: typeof fetch = fetch, accessToken?: string): Promise<CleanupResult> {
  if (!isRequestId(request.requestId) || !isSpeechLanguage(request.language) || typeof request.text !== 'string' || !request.text.trim() || request.text.length > MAX_CLEANUP_CHARS) {
    throw new LocalApiError('CLEANUP_INPUT', 'This transcript cannot be sent for cleanup. The original is available.');
  }
  if(!base.startsWith('/'))base=apiEndpoint(base);
  const remote=hostedEndpoint(base);
  const deadline = AbortSignal.timeout(remote?120_000:30_000);
  const combined = AbortSignal.any([signal, deadline]);
  const read = async (response: Response) => {
    let data: unknown;
    try { data = await response.json(); } catch { throw new LocalApiError('LOCAL_API', 'The local API returned an unreadable cleanup response.'); }
    if (!response.ok) {
      const error = data as { code?: unknown; message?: unknown; resetAt?: unknown };
      throw new LocalApiError(typeof error.code === 'string' ? error.code : 'LOCAL_API', typeof error.message === 'string' && error.message.length <= 400 ? error.message+resetMessage(error.resetAt) : 'Cleanup failed. The original transcript is available.');
    }
    return data;
  };
  try {
    const session = remote ? await warmHostedAPI(base,combined,fetcher,accessToken) : await read(await fetcher(base + '/v1/local-session', { signal: combined, cache: 'no-store', redirect: 'error' })) as { token?: unknown };
    if (!remote && (typeof session?.token !== 'string' || !/^[a-f0-9]{64}$/.test(session.token))) throw new LocalApiError('LOCAL_SESSION', 'Could not open a local cleanup session.');
    const result = await read(await fetcher(base + '/v1/cleanup', {
      method: 'POST', signal: combined, redirect: 'error', headers: {
        ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}), 'Content-Type': 'application/json', ...(!remote?{'x-sargosh-token': session.token as string}:{}), 'x-sargosh-request-id': request.requestId
      }, body: JSON.stringify({ text: request.text, language: request.language })
    })) as Partial<CleanupResult>;
    if (typeof result?.text !== 'string' || result.text.length > Math.max(512, request.text.length * 2 + 256) || !isCleanupModel(result.model)) throw new LocalApiError('LOCAL_API', 'The local API returned an invalid cleanup result.');
    return result as CleanupResult;
  } catch (error) {
    if (signal.aborted) throw new LocalApiError('CANCELLED', 'Cleanup cancelled.');
    if (deadline.aborted) throw new LocalApiError('LOCAL_TIMEOUT', 'Cleanup took too long. The original transcript is available.');
    if (error instanceof LocalApiError) throw error;
    throw new LocalApiError('LOCAL_CONNECTION', remote?'Could not reach the cleanup service. The original transcript is available.':'Could not reach the local cleanup API. The original transcript is available.');
  }
}

async function warmHostedAPI(base:string,signal:AbortSignal,fetcher:typeof fetch,accessToken?:string):Promise<{token?:string}>{
 if(!accessToken)throw new LocalApiError('AUTH_REQUIRED','Sign in to use cloud dictation.');
 const response=await fetcher(base+'/health',{signal,cache:'no-store',redirect:'error'});
 if(!response.ok)throw new LocalApiError('CLOUD_STARTING','The service is starting. Please try again shortly.');
 const value=await response.json().catch(()=>null);
 if(value?.status!=='ok'||value?.service!=='sargosh-api')throw new LocalApiError('CLOUD_STARTING','The service is starting. Please try again shortly.');
 return {};
}

function resetMessage(value:unknown):string {
 return typeof value==='string'&&Number.isFinite(Date.parse(value))?' Resets '+new Date(value).toLocaleString()+'.':'';
}

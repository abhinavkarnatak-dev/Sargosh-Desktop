import type { CleanupRequest, CleanupResult } from '../shared/cleanup';
import { cleanupViaLocalAPI, transcribeViaLocalAPI } from '../shared/local-api';
import type { TranscriptionRequest, Transcript } from '../shared/transcription';
import { LocalApiError } from '../shared/local-api';
export type TranscriptionReply = { ok: true; result: Transcript } | { ok: false; code: string; message: string };
export class DesktopTranscriber {
  constructor(private token?: () => Promise<string>) {}
  private active = new Map<string, AbortController>();
  get busy() { return this.active.size > 0; }
  async transcribe(request: TranscriptionRequest): Promise<TranscriptionReply> {
    if (this.active.size) return { ok: false, code: 'BUSY', message: 'A transcription is already running.' };
    const abort = new AbortController(); this.active.set(request.requestId, abort);
    try { return { ok: true, result: await transcribeViaLocalAPI(request, abort.signal, undefined, undefined, this.token ? await this.token() : undefined) }; }
    catch (error) { return { ok: false, code: error instanceof LocalApiError ? error.code : 'LOCAL_API', message: error instanceof LocalApiError ? error.message : 'Transcription could not complete.' }; }
    finally { this.active.delete(request.requestId); }
  }
  async cleanup(request: CleanupRequest): Promise<{ ok: true; result: CleanupResult } | { ok: false; code: string; message: string }> {
    if (this.active.size) return { ok: false, code: 'BUSY', message: 'A cloud request is already running.' };
    const abort = new AbortController(); this.active.set(request.requestId, abort);
    try { return { ok: true, result: await cleanupViaLocalAPI(request, abort.signal, undefined, undefined, this.token ? await this.token() : undefined) }; }
    catch (error) { return { ok: false, code: error instanceof LocalApiError ? error.code : 'LOCAL_API', message: error instanceof LocalApiError ? error.message : 'Cleanup failed. The original transcript is available.' }; }
    finally { this.active.delete(request.requestId); }
  }
  cancel(id: string) { this.active.get(id)?.abort(); }
  cancelAll() { for (const abort of this.active.values()) abort.abort(); }
}

export class CleanupError extends Error {
  constructor(public code: string, message: string, public status = 502) { super(message); }
}
export const CLEANUP_MAX_ATTEMPTS = 2;
export const cleanupOutputLimit = (text: string) => Math.min(16384, Math.max(512, text.length * 2 + 128));

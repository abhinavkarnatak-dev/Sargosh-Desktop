export type Phase = 'ready' | 'starting' | 'recording' | 'finishing' | 'transcribing' | 'cleaning' | 'delivering' | 'completed' | 'cancelled' | 'failed';
export interface Session { id: string; phase: Phase; target: string | null; delivered: boolean }
export type Event = { type: 'started' | 'stop' | 'audio-ready' | 'transcribed' | 'cleaned' | 'delivered' | 'cancel' | 'fail'; sessionId: string } | { type: 'target'; sessionId: string; target: string };
export function transition(session: Session, event: Event): Session {
  if (event.sessionId !== session.id || ['completed', 'cancelled', 'failed'].includes(session.phase)) return session;
  if (event.type === 'cancel') return { ...session, phase: 'cancelled' };
  if (event.type === 'fail') return { ...session, phase: 'failed' };
  if (event.type === 'target') return ['starting', 'recording'].includes(session.phase) ? { ...session, target: event.target } : session;
  const next: Partial<Record<Phase, { event: string; phase: Phase }>> = {
    starting: { event: 'started', phase: 'recording' },
    recording: { event: 'stop', phase: 'finishing' },
    finishing: { event: 'audio-ready', phase: 'transcribing' },
    transcribing: { event: 'transcribed', phase: 'cleaning' },
    cleaning: { event: 'cleaned', phase: 'delivering' },
    delivering: { event: 'delivered', phase: 'completed' }
  };
  const step = next[session.phase];
  return step?.event === event.type ? { ...session, phase: step.phase, delivered: event.type === 'delivered' } : session;
}
export function normalizeDashes(text: string): string { return text.replace(/[\u2013\u2014]/g, '-'); }

import { TimingTrace, setTimingSink, type TimingOutcome } from '../../shared/timing';

// One bounded entry per recording. Late replies cannot finish a newer recording.
const sessions = new Map<string, { complete: ReturnType<TimingTrace['span']>; first: ReturnType<TimingTrace['span']>; firstSeen: boolean; finished: boolean }>();
export function initializeTimingOutput() {
  setTimingSink(event => {
    if (window.sargosh?.reportTiming) void window.sargosh.reportTiming(event).catch(() => {});
    else console.info(JSON.stringify(event));
  });
}
export function startDictationTiming(id: string) {
  const previous = sessions.get(id);
  if (previous) { previous.complete.end('cancelled'); previous.first.end('cancelled'); }
  sessions.delete(id);
}
export function markDictationStop(id: string) {
  if (sessions.has(id)) return;
  if (sessions.size >= 64) {
    const oldest = sessions.keys().next().value!;
    finishDictationTiming(oldest, 'skipped'); sessions.delete(oldest);
  }
  const trace = new TimingTrace(id, 'desktop');
  sessions.set(id, { complete: trace.span('dictation.stop_to_complete'), first: trace.span('dictation.stop_to_first_input_ack'), firstSeen: false, finished: false });
}
export function markFirstInput(id: string) {
  const session = sessions.get(id);
  if (!session || session.finished || session.firstSeen) return;
  session.firstSeen = true; session.first.end();
}
export function finishDictationTiming(id: string, outcome: TimingOutcome) {
  const session = sessions.get(id);
  if (!session || session.finished) return;
  session.finished = true; session.complete.end(outcome);
  if (!session.firstSeen) session.first.end(outcome === 'ok' ? 'skipped' : outcome);
}

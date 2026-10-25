import { describe, expect, it } from 'vitest';
import { normalizeDashes, transition, type Event, type Session } from '../src/shared/lifecycle';
const initial = (): Session => ({ id: 'a', phase: 'starting', target: 'input-1', delivered: false });
describe('dictation lifecycle', () => {
  it('collects final audio before beginning transcription', () => {
    let state = transition(initial(), { type: 'started', sessionId: 'a' });
    state = transition(state, { type: 'stop', sessionId: 'a' });
    expect(state.phase).toBe('finishing');
    expect(transition(state, { type: 'transcribed', sessionId: 'a' }).phase).toBe('finishing');
    expect(transition(state, { type: 'audio-ready', sessionId: 'a' }).phase).toBe('transcribing');
  });
  it('ignores cancelled results, including results after a new session', () => {
    const cancelled = transition(initial(), { type: 'cancel', sessionId: 'a' });
    expect(transition(cancelled, { type: 'transcribed', sessionId: 'a' })).toBe(cancelled);
    const current = { ...initial(), id: 'b' };
    expect(transition(current, { type: 'transcribed', sessionId: 'a' })).toBe(current);
  });
  it('tracks the latest input while speaking and freezes it after stop', () => {
    let state = transition(initial(), { type: 'started', sessionId: 'a' });
    state = transition(state, { type: 'target', sessionId: 'a', target: 'input-2' });
    expect(state.target).toBe('input-2');
    state = transition(state, { type: 'stop', sessionId: 'a' });
    expect(transition(state, { type: 'target', sessionId: 'a', target: 'input-3' }).target).toBe('input-2');
  });
  it('permits one completion and ignores repeated stop or delivery events', () => {
    let state = initial();
    for (const type of ['started', 'stop', 'audio-ready', 'transcribed', 'cleaned', 'delivered']) state = transition(state, { type, sessionId: 'a' } as Event);
    expect(state).toMatchObject({ phase: 'completed', delivered: true });
    expect(transition(state, { type: 'delivered', sessionId: 'a' })).toBe(state);
    expect(transition(state, { type: 'stop', sessionId: 'a' })).toBe(state);
  });
  it('does not revive failed sessions', () => {
    const failed = transition(initial(), { type: 'fail', sessionId: 'a' });
    expect(transition(failed, { type: 'started', sessionId: 'a' })).toBe(failed);
  });
  it('enforces ordinary hyphens without changing other punctuation', () => {
    expect(normalizeDashes('Tuesday\u2014sorry\u2013Thursday, 10:30.')).toBe('Tuesday-sorry-Thursday, 10:30.');
  });
});

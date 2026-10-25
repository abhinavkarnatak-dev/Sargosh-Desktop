import { describe, expect, it } from 'vitest';
import { activityDays, localDate, streaks, wordsPerMinute } from '../src/shared/insights';
describe('insights', () => {
  it('uses total words and duration for weighted WPM', () => { expect(wordsPerMinute(110, 180000)).toBe(37); expect(wordsPerMinute(0, 0)).toBe(0); });
  it('shows an empty history as zero rather than invented data', () => { expect(streaks([])).toEqual({ current: 0, longest: 0 }); });
  it('allows yesterday to carry a current streak before today is used', () => {
    const days = [{ date: '2026-10-23', words: 10 }, { date: '2026-10-24', words: 20 }];
    expect(streaks(days, new Date(2026, 9, 25))).toEqual({ current: 2, longest: 2 });
  });
  it('breaks a streak across a missing day and ignores zero-word days', () => {
    const days = [{ date: '2026-10-20', words: 5 }, { date: '2026-10-21', words: 10 }, { date: '2026-10-24', words: 0 }];
    expect(streaks(days, new Date(2026, 9, 25))).toEqual({ current: 0, longest: 2 });
  });
  it('builds full weeks with local dates and no duplicate days', () => {
    const days = activityDays(new Date(2026, 9, 25));
    expect(days).toHaveLength(140); expect(new Set(days).size).toBe(140);
    expect(new Date(days[0] + 'T12:00:00').getDay()).toBe(0);
    expect(localDate(new Date(2026, 0, 1))).toBe('2026-01-01');
  });
});

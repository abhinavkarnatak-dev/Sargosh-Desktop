import type { DayActivity } from './types';
export function wordsPerMinute(words: number, durationMs: number): number {
  return durationMs > 0 ? Math.round(words / (durationMs / 60_000)) : 0;
}
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function activityDays(today = new Date(), weeks = 20): string[] {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  end.setDate(end.getDate() + (6 - end.getDay()));
  const start = new Date(end); start.setDate(start.getDate() - weeks * 7 + 1);
  return Array.from({ length: weeks * 7 }, (_, index) => { const date = new Date(start); date.setDate(date.getDate() + index); return localDate(date); });
}
export function streaks(activity: DayActivity[], today = new Date()): { current: number; longest: number } {
  const days = new Set(activity.filter(day => day.words > 0).map(day => day.date));
  let longest = 0; let run = 0; let previous = '';
  for (const day of [...days].sort()) {
    const date = new Date(`${day}T12:00:00`); date.setDate(date.getDate() - 1);
    run = previous === localDate(date) ? run + 1 : 1;
    longest = Math.max(longest, run); previous = day;
  }
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!days.has(localDate(cursor))) cursor.setDate(cursor.getDate() - 1);
  let current = 0;
  while (days.has(localDate(cursor))) { current++; cursor.setDate(cursor.getDate() - 1); }
  return { current, longest };
}

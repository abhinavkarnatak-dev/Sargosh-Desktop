import { expect, it } from 'vitest';
import { recordingNotice, recoveryTextForCopy, validOverlayNotice } from '../src/shared/overlay-notice';
import { INITIAL_RECORDING_STATE } from '../src/shared/recording';
import { resizeOverlayBounds } from '../src/main/overlay-bounds';
it('validates notice fields and bounds recovered text', () => {
  const notice = { id: 'one', kind: 'recovery', title: 'Text ready', message: 'Copy below', text: 'Hello' };
  expect(validOverlayNotice(notice)).toBe(true);
  for (const patch of [{ text: 'a'.repeat(24001) }, { kind: 'unknown' }, { title: 123 }, { id: '' }, { message: 'a'.repeat(401) }]) expect(validOverlayNotice({ ...notice, ...patch })).toBe(false);
});
it('does not show stale cards while recording or preparing text', () => {
  const speech = { phase: 'failed' as const, message: '', notice: { id: 'old', kind: 'recovery' as const, title: 'Ready', message: '', text: 'Old text' } };
  expect(recordingNotice({ ...INITIAL_RECORDING_STATE, phase: 'opening' }, speech)).toBeNull();
  expect(recordingNotice(INITIAL_RECORDING_STATE, { ...speech, phase: 'working' })).toBeNull();
  expect(recordingNotice(INITIAL_RECORDING_STATE, speech)?.text).toBe('Old text');
});
it('resizes around the pill bottom without moving it and clamps to the display', () => {
  const bounds = { x: 500, y: 800, width: 420, height: 120 }; const area = { x: 0, y: 0, width: 1920, height: 1080 };
  expect(resizeOverlayBounds(bounds, area, 350)).toEqual({ x: 500, y: 570, width: 420, height: 350 });
  expect(resizeOverlayBounds({ ...bounds, x: 1900, y: -20 }, area, 500)).toMatchObject({ x: 1500, y: 0, height: 400 });
  expect(resizeOverlayBounds({ ...bounds, y: 570, height: 350 }, area, 120)).toEqual(bounds);
});

it('copies only the current recovery text and rejects expired or processing notices', () => {
  const status = { phase: 'failed' as const, message: '', notice: { id: 'current', kind: 'recovery' as const, title: 'Ready', message: '', text: 'Exact prepared text.' } };
  expect(recoveryTextForCopy(status, 'current')).toBe('Exact prepared text.');
  expect(() => recoveryTextForCopy(status, 'old')).toThrow('no longer available');
  expect(() => recoveryTextForCopy({ ...status, phase: 'working' }, 'current')).toThrow();
  expect(() => recoveryTextForCopy({ phase: 'idle', message: '' }, 'current')).toThrow();
});

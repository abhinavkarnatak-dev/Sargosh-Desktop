// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react'; import { createRoot, type Root } from 'react-dom/client';
import { HistoryList, historyDayLabel } from '../src/renderer/HistoryList';
import type { HistoryEntry } from '../src/shared/types';
let host: HTMLDivElement; let root: Root; let entries: HistoryEntry[]; let changed: () => void;
const notice = vi.fn(); const copy = vi.fn(); const extract = vi.fn(); const retry = vi.fn(); const remove = vi.fn(); const historyAudio = vi.fn();
const id = '11111111-1111-4111-8111-111111111111';
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); notice.mockClear(); copy.mockReset().mockResolvedValue(undefined); extract.mockReset().mockResolvedValue(true); retry.mockReset().mockResolvedValue(undefined); remove.mockReset().mockImplementation(async () => { entries = []; });
  historyAudio.mockReset().mockResolvedValue({ audio: new ArrayBuffer(4), mimeType: 'audio/webm' });
  entries = [{ id, createdAt: new Date().toISOString(), text: 'Please send the notes to Priya.', words: 7, durationMs: 3000, status: 'completed', audioBytes: 4, audioMimeType: 'audio/webm' }];
  vi.stubGlobal('window', window); window.sargosh = {
    listHistory: async () => ({ entries, hasMore: false }), onHistoryChanged: (callback: () => void) => { changed = callback; return () => {}; },
    copyHistoryText: copy, extractHistoryAudio: extract, retryHistory: retry, deleteEntry: remove, historyAudio
  } as unknown as NonNullable<typeof window.sargosh>;
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined); vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete window.sargosh; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(createElement(HistoryList, { onNotice: notice }))); }
async function click(selector: string) { const element = host.querySelector(selector) as HTMLElement; expect(element).not.toBeNull(); await act(async () => element.click()); }
it('renders transcript, time, and precisely the three requested menu actions', async () => {
  await render(); expect(host.textContent).toContain('Today'); expect(host.querySelector('time')?.getAttribute('datetime')).toBe(entries[0].createdAt);
  expect(host.textContent).toContain('Please send the notes'); await click('[aria-label="Transcript options"]');
  expect([...host.querySelectorAll('[role="menuitem"]')].map(button => button.textContent)).toEqual(['Retry transcript', 'Delete transcript', 'Extract audio']);
});
it('copies the saved transcript and extracts original audio only when explicitly clicked', async () => {
  await render(); await click('[aria-label="Copy transcript"]'); expect(copy).toHaveBeenCalledExactlyOnceWith(id); expect(notice).toHaveBeenCalledWith('Transcript copied.');
  await click('[aria-label="Transcript options"]'); await act(async () => (host.querySelectorAll('[role="menuitem"]')[2] as HTMLElement).click());
  expect(extract).toHaveBeenCalledExactlyOnceWith(id); expect(notice).toHaveBeenCalledWith('Original audio saved.');
});
it('plays original saved audio rather than the current recording preview', async () => {
  await render(); await click('[aria-label="Play audio"]'); expect(historyAudio).toHaveBeenCalledExactlyOnceWith(id);
  expect(host.querySelector('[aria-label="Pause audio"]')).not.toBeNull(); expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
});
it('retries a saved transcript without invoking text delivery', async () => {
  await render(); await click('[aria-label="Transcript options"]'); await act(async () => (host.querySelectorAll('[role="menuitem"]')[0] as HTMLElement).click());
  expect(retry).toHaveBeenCalledExactlyOnceWith(id);
});
it('requires confirmation before deleting and refreshes the list afterward', async () => {
  await render(); await click('[aria-label="Transcript options"]'); await act(async () => (host.querySelectorAll('[role="menuitem"]')[1] as HTMLElement).click());
  expect(remove).not.toHaveBeenCalled(); expect(host.querySelector('dialog')?.open).toBe(true);
  await click('dialog .button.danger'); expect(remove).toHaveBeenCalledExactlyOnceWith(id); expect(host.querySelector('.dictation-row')).toBeNull();
});
it('updates live when a background dictation is saved', async () => {
  entries = []; await render(); entries = [{ id, createdAt: new Date().toISOString(), text: 'New dictation', words: 2, durationMs: 1000, status: 'completed', audioBytes: 4 }];
  await act(async () => changed()); expect(host.textContent).toContain('New dictation');
});
it('groups local calendar dates correctly across midnight', () => {
  const today = new Date(2026, 9, 26, 0, 10); const yesterday = new Date(2026, 9, 25, 23, 55);
  expect(historyDayLabel(today.toISOString(), today)).toBe('Today'); expect(historyDayLabel(yesterday.toISOString(), today)).toBe('Yesterday');
});

async function deleteConfirmation() {
  await render(); await click('[aria-label="Transcript options"]'); await act(async () => (host.querySelectorAll('[role="menuitem"]')[1] as HTMLElement).click());
  const dialog = host.querySelector('dialog')!;
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 600, top: 100, bottom: 400 } as DOMRect);
  return dialog;
}
async function outsideGesture(dialog: HTMLDialogElement, start: Element = dialog, from = [50, 50], to = [50, 50]) {
  await act(async () => {
    start.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: from[0], clientY: from[1] }));
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: to[0], clientY: to[1] }));
  });
}
it('dismisses deletion on a backdrop click without removing history', async () => {
  const dialog = await deleteConfirmation(); await outsideGesture(dialog);
  expect(host.querySelector('dialog')).toBeNull(); expect(remove).not.toHaveBeenCalled(); expect(host.textContent).toContain('Please send the notes');
});
it('keeps delete confirmation open for inside clicks or a drag from inside to outside', async () => {
  const dialog = await deleteConfirmation(); await outsideGesture(dialog, dialog, [200, 200], [200, 200]);
  expect(dialog.open).toBe(true); await outsideGesture(dialog, dialog.querySelector('p')!, [200, 200]);
  expect(dialog.open).toBe(true); expect(remove).not.toHaveBeenCalled();
});

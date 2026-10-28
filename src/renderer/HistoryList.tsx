import { useModalDialog, useModalDismiss } from './modal';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Copy, Download, LoaderCircle, Mic, MoreHorizontal, Pause, Play, RotateCcw, Trash2, X } from 'lucide-react';
import type { HistoryEntry } from '../shared/types';
import { localDate } from '../shared/insights';
import { retryHistory } from './audio/runtime';
import { useSavedHistory } from './audio/history';
export function historyDayLabel(value: string, today = new Date()): string {
  const date = new Date(value); if (localDate(date) === localDate(today)) return 'Today';
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  return localDate(date) === localDate(yesterday) ? 'Yesterday' : date.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
}
export function HistoryList({ onNotice }: { onNotice(message: string): void }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]); const [more, setMore] = useState(false); const [loading, setLoading] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null); const [deleting, setDeleting] = useState<HistoryEntry | null>(null); const [deletingBusy, setDeletingBusy] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null); const [error, setError] = useState('');
  const pages = useRef(1); const generation = useRef(0); const audioGeneration = useRef(0);
  const audio = useRef<HTMLAudioElement>(null); const loaded = useRef<{ id: string; url: string } | null>(null);
  const menu = useRef<HTMLDivElement>(null); const menuButton = useRef<HTMLButtonElement>(null);
  const archive = useSavedHistory();
  const reload = useCallback(async () => {
    if (!window.sargosh?.listHistory) return;
    const current = ++generation.current; setLoading(true);
    try {
      const rows: HistoryEntry[] = []; let cursor: { createdAt: string; id: string } | undefined; let hasMore = false;
      for (let page = 0; page < pages.current; page++) {
        const result = await window.sargosh.listHistory(cursor); rows.push(...result.entries); hasMore = result.hasMore;
        const last = result.entries.at(-1); if (!hasMore || !last) break;
        cursor = { id: last.id, createdAt: last.createdAt };
      }
      if (current !== generation.current) return;
      setEntries(rows); setMore(hasMore); setError('');
    } catch { if (current === generation.current) setError('Local history could not be opened. Restart Sargosh and check that the local storage is available.'); }
    finally { if (current === generation.current) setLoading(false); }
  }, []);
  useEffect(() => {
    void reload(); const unsubscribe = window.sargosh?.onHistoryChanged?.(() => { void reload(); });
    return () => { generation.current++; unsubscribe?.(); };
  }, [reload]);
  function stop() {
    audioGeneration.current++; audio.current?.pause();
    if (audio.current) audio.current.removeAttribute('src');
    if (loaded.current) URL.revokeObjectURL(loaded.current.url);
    loaded.current = null; setPlaying(null);
  }
  useEffect(() => () => { audioGeneration.current++; if (loaded.current) URL.revokeObjectURL(loaded.current.url); }, []);
  useEffect(() => {
    if (loaded.current && !entries.some(entry => entry.id === loaded.current!.id)) stop();
    if (menuId && !entries.some(entry => entry.id === menuId)) setMenuId(null);
  }, [entries, menuId]);
  async function play(entry: HistoryEntry) {
    const player = audio.current; if (!player) return;
    if (playing === entry.id) { player.pause(); return; }
    const current = ++audioGeneration.current;
    try {
      if (loaded.current?.id !== entry.id) {
        player.pause();
        const clip = await window.sargosh!.historyAudio(entry.id); if (current !== audioGeneration.current) return;
        if (loaded.current) URL.revokeObjectURL(loaded.current.url);
        const url = URL.createObjectURL(new Blob([clip.audio], { type: clip.mimeType })); loaded.current = { id: entry.id, url }; player.src = url;
      }
      if (player.ended) player.currentTime = 0;
      await player.play(); if (current === audioGeneration.current) setPlaying(entry.id);
    } catch { if (current === audioGeneration.current) setError('Could not play the original recording. It may be missing or unavailable.'); }
  }
  useLayoutEffect(() => {
    if (!menuId || !menu.current || !menuButton.current) return;
    const element = menu.current; element.showPopover?.();
    const position = () => {
      const bounds = menuButton.current?.getBoundingClientRect(); if (!bounds) return;
      const up = window.innerHeight - bounds.bottom < 155;
      Object.assign(element.style, { left: Math.max(8, Math.min(bounds.right - 206, window.innerWidth - 214)) + 'px', top: up ? 'auto' : bounds.bottom + 5 + 'px', bottom: up ? window.innerHeight - bounds.top + 5 + 'px' : 'auto' });
    };
    position(); element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => { if (!element.contains(event.target as Node) && !menuButton.current?.contains(event.target as Node)) setMenuId(null); };
    document.addEventListener('pointerdown', outside, true); window.addEventListener('scroll', position, true); window.addEventListener('resize', position);
    return () => { element.hidePopover?.(); document.removeEventListener('pointerdown', outside, true); window.removeEventListener('scroll', position, true); window.removeEventListener('resize', position); };
  }, [menuId]);
  async function perform(entry: HistoryEntry, action: 'copy' | 'retry' | 'extract') {
    setMenuId(null); setError('');
    try {
      if (action === 'copy') { await window.sargosh!.copyHistoryText(entry.id); onNotice('Transcript copied.'); }
      if (action === 'retry') await retryHistory(entry.id);
      if (action === 'extract' && await window.sargosh!.extractHistoryAudio(entry.id)) onNotice('Original audio saved.');
    } catch { setError(action === 'retry' ? 'Finish the current dictation before retrying this transcript.' : 'That action could not complete. The original recording may be unavailable.'); }
  }
  async function remove() {
    if (!deleting || deletingBusy) return;
    setDeletingBusy(true);
    try { if (loaded.current?.id === deleting.id) stop(); await window.sargosh!.deleteEntry(deleting.id); setDeleting(null); onNotice('Transcript and recording deleted.'); await reload(); }
    catch { setDeleting(null); setError('Could not delete this recording. Please try again.'); }
    finally { setDeletingBusy(false); }
  }
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of entries) { const day = historyDayLabel(entry.createdAt); const rows = groups.get(day) ?? []; rows.push(entry); groups.set(day, rows); }
  return <section className="history-section" aria-labelledby="history-heading">
    <div className="section-heading"><h2 id="history-heading">Your dictations</h2></div>
    {error && <p role="alert" className="error-message">{error}</p>}
    {!entries.length && !loading && !error && <div className="empty-history"><div className="empty-icon"><Mic size={25} /></div><h3>Your first words belong here.</h3><p>{window.sargosh ? 'Your finished recordings and transcripts will appear here.' : 'Open the desktop app to save recordings and transcripts on this computer.'}</p></div>}
    {[...groups].map(([day, rows]) => <div className="history-day" key={day}><h3>{day}</h3><div className="dictation-list">{rows.map(entry => <article className={'dictation-row' + (menuId === entry.id || playing === entry.id ? ' active' : '')} key={entry.id}>
      <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
      <div className="dictation-row-text"><p>{entry.text || (entry.status === 'pending' ? 'Recording ready to transcribe.' : entry.error || 'No transcript available.')}</p>{entry.error && entry.text && <span>{entry.error}</span>}{archive.retryingId === entry.id && <span role="status"><LoaderCircle size={12} className="overlay-spinner" />Preparing transcript...</span>}</div>
      <div className="dictation-row-actions">
        <button className="icon-button" disabled={!entry.audioBytes} aria-label={playing === entry.id ? 'Pause audio' : 'Play audio'} data-tooltip={playing === entry.id ? 'Pause audio' : 'Play audio'} onClick={() => void play(entry)}>{playing === entry.id ? <Pause size={17} /> : <Play size={17} />}</button>
        <button className="icon-button" aria-label="Copy transcript" data-tooltip="Copy transcript" disabled={!entry.text} onClick={() => void perform(entry, 'copy')}><Copy size={17} /></button>
        <button ref={menuId === entry.id ? menuButton : undefined} className="icon-button" aria-label="Transcript options" data-tooltip="Transcript options" aria-haspopup="menu" aria-expanded={menuId === entry.id} onClick={() => setMenuId(current => current === entry.id ? null : entry.id)}><MoreHorizontal size={18} /></button>
        {menuId === entry.id && <div ref={menu} className="history-menu" popover="manual" role="menu" aria-label="Transcript options" onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMenuId(null); menuButton.current?.focus(); }
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }
        }}>
          <button role="menuitem" disabled={!entry.audioBytes || archive.retryingId !== null} onClick={() => void perform(entry, 'retry')}><RotateCcw size={16} />Retry transcript</button>
          <button role="menuitem" className="danger-text" disabled={archive.retryingId === entry.id} onClick={() => { setMenuId(null); setDeleting(entry); }}><Trash2 size={16} />Delete transcript</button>
          <button role="menuitem" disabled={!entry.audioBytes} onClick={() => void perform(entry, 'extract')}><Download size={16} />Extract audio</button>
        </div>}
      </div>
    </article>)}</div></div>)}
    {loading && <p className="inline-help" role="status">Loading history...</p>}
    {more && <button className="button secondary history-more" disabled={loading} onClick={() => { pages.current++; void reload(); }}>Load older dictations</button>}
    <audio ref={audio} onEnded={() => setPlaying(null)} onPause={() => setPlaying(null)} hidden />
    {deleting && <DeleteDialog busy={deletingBusy} onClose={() => { if (!deletingBusy) setDeleting(null); }} onConfirm={() => void remove()} />}
  </section>;
}
function DeleteDialog({ busy, onClose: onDismissed, onConfirm }: { busy: boolean; onClose(): void; onConfirm(): void }) {
  const {closing,dismiss:onClose}=useModalDismiss(onDismissed);
  const dialog = useRef<HTMLDialogElement>(null);
  const outsidePress = useRef(false);
  function outside(element: HTMLDialogElement, x: number, y: number) {
    const bounds = element.getBoundingClientRect();
    return x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom;
  }
  useModalDialog(dialog);
  return <dialog className="history-delete-dialog animated-modal" data-closing={closing} ref={dialog} aria-labelledby="delete-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onPointerDown={event => {
    outsidePress.current = event.target === event.currentTarget && outside(event.currentTarget, event.clientX, event.clientY);
  }} onClick={event => {
    const dismiss = outsidePress.current && event.target === event.currentTarget && outside(event.currentTarget, event.clientX, event.clientY);
    outsidePress.current = false;
    if (dismiss && !busy) onClose();
  }}>
    <button className="icon-button history-delete-close" aria-label="Close delete confirmation" disabled={busy || closing} onClick={onClose}><X size={18} /></button>
    <h2 id="delete-title">Delete this dictation?</h2><p>This deletes the transcript and original audio from this computer. Your accumulated usage totals stay unchanged.</p>
    <div className="dialog-actions"><button className="button secondary" disabled={busy || closing} onClick={onClose}>Keep dictation</button><button className="button danger" disabled={busy || closing} onClick={onConfirm}>{busy ? 'Deleting...' : 'Delete transcript'}</button></div>
  </dialog>;
}

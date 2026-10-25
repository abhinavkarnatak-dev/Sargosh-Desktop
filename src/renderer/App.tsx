import { ThemeMenu } from './ThemeMenu';
import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Check, ChevronRight, Copy, Mic, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Play, Settings, ShieldCheck, Trash2, X } from 'lucide-react';
import { EMPTY_SNAPSHOT, type Preferences, type Snapshot } from '../shared/types';
import { wordsPerMinute } from '../shared/insights';
import { RecordingPanel } from './RecordingPanel';
import { setRecordingPreferences } from './audio/runtime';
import { Insights } from './Insights';
import { SettingsDialog } from './SettingsDialog';

export function App() {
  const [page, setPage] = useState<'dictation' | 'insights'>('dictation');
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);
  const [settings, setSettings] = useState(false);
  const [notice, setNotice] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!window.sargosh) return;
    try { setSnapshot(await window.sargosh.snapshot()); }
    catch { setNotice('Local history could not be opened. Check that the Python helper is running.'); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => window.sargosh?.onOpenSettings?.(() => setSettings(true)), []);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const theme = snapshot.preferences.theme === 'system' ? (query.matches ? 'dark' : 'light') : snapshot.preferences.theme;
      document.documentElement.dataset.theme = theme;
      void window.sargosh?.setWindowTheme?.(theme).catch(() => {});
    };
    apply(); query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [snapshot.preferences.theme]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 7000); return () => clearTimeout(timer); }, [notice]);
  async function savePreferences(update: Partial<Preferences>) {
    try {
      if (!window.sargosh) { setSnapshot(current => ({ ...current, preferences: { ...current.preferences, ...update } })); return; }
      const preferences = await window.sargosh.preferences(update);
      setSnapshot(current => ({ ...current, preferences }));
    } catch { setNotice('Your preference could not be saved. Please try again.'); }
  }
  async function removeEntry() {
    if (!deleting || !window.sargosh) return;
    try { await window.sargosh.deleteEntry(deleting); setDeleting(null); await refresh(); } catch { setNotice('The recording could not be deleted.'); }
  }
  useEffect(() => { setRecordingPreferences(snapshot.preferences); }, [snapshot.preferences]);
  const collapsed = snapshot.preferences.collapsed;
  return <div className="app-frame">
    <header className="desktop-titlebar" aria-label="Window title bar"><button className="icon-button sidebar-toggle" aria-expanded={!collapsed} aria-controls="sargosh-sidebar" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => void savePreferences({ collapsed: !collapsed })}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button><ThemeMenu theme={snapshot.preferences.theme} onChange={theme => void savePreferences({ theme })} /></header>
    <div className={collapsed ? 'app-shell collapsed' : 'app-shell'}>
    <aside className="sidebar" id="sargosh-sidebar">
      <div className="sidebar-top">

        <a className="brand" href="#" aria-label="Sargosh home" onClick={event => { event.preventDefault(); setPage('dictation'); }}>
          <img className="brand-dark" src="./brand/logo-dark.png" alt="" /><img className="brand-light" src="./brand/logo-light.png" alt="" />
          <span className="sidebar-label">Sargosh<span className="brand-caption">A little less typing.</span></span>
        </a>
        <nav aria-label="Main navigation">
          <button title="Dictation" className={page === 'dictation' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('dictation')}><Mic size={19} /><span className="sidebar-label">Dictation</span></button>
          <button title="Insights" className={page === 'insights' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('insights')}><BarChart3 size={19} /><span className="sidebar-label">Insights</span></button>
        </nav>
      </div>
      <div className="sidebar-bottom">
        <button title="Settings" className="nav-item" onClick={() => setSettings(true)}><Settings size={19} /><span className="sidebar-label">Settings</span></button>
      </div>
    </aside>
    <main className="main-surface">

      <div className="page-content">
        {page === 'dictation' ? <>
          <div className="page-heading"><div><p className="eyebrow">DICTATION</p><h1>Welcome to Sargosh</h1><p className="subtitle">Speak naturally. Make room for your thoughts.</p></div></div>
          <div className="dictation-stats">
            <section className="dictation-stat"><Mic size={19} strokeWidth={1.5} /><div><span className="stat-number">{snapshot.totalWords.toLocaleString()}</span><span className="stat-label">total words dictated</span></div></section>
            <section className="dictation-stat"><BarChart3 size={19} strokeWidth={1.5} /><div><span className="stat-number">{wordsPerMinute(snapshot.totalWords, snapshot.totalDurationMs)}<small>wpm</small></span><span className="stat-label">average dictation speed</span></div></section>
          </div>
          <RecordingPanel preferences={snapshot.preferences} />
          <section className="history-section" aria-labelledby="history-heading">
            <div className="section-heading"><h2 id="history-heading">Your dictations</h2><span><ShieldCheck size={13} /> Stored locally</span></div>
            {!snapshot.history.length ? <div className="empty-history"><div className="empty-icon"><Mic size={25} strokeWidth={1.5} /></div><h3>Your first words belong here.</h3><p>Once dictation is connected, your recordings and<br className="desktop-break" /> transcribed text will appear in this space.</p><button className="text-button" onClick={() => setSettings(true)}>Check your microphone <ChevronRight size={15} /></button></div> :
            <div className="history-list">{snapshot.history.map(entry => <article className="history-entry" key={entry.id}>
              <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
              <p>{entry.text || entry.error || 'No transcript available.'}</p><div className="history-actions">
              <button className="icon-button" aria-label="Play recording" disabled title="Audio playback will be connected with recording"><Play size={16} /></button>
              <button className="icon-button" aria-label="Copy transcript" disabled={!entry.text} onClick={() => void navigator.clipboard.writeText(entry.text).then(() => setNotice('Transcript copied.'), () => setNotice('Could not copy the transcript.'))}><Copy size={16} /></button>
              <div className="menu-wrap"><button className="icon-button" aria-label="Recording options" aria-expanded={menu === entry.id} onClick={() => setMenu(menu === entry.id ? null : entry.id)}><MoreHorizontal size={18} /></button>{menu === entry.id && <div className="context-menu"><button disabled title="Cloud transcription is not connected">Retry transcription</button><button className="danger-text" onClick={() => { setMenu(null); setDeleting(entry.id); }}><Trash2 size={14} />Delete</button></div>}</div>
              </div></article>)}</div>}
          </section>
        </> : <Insights snapshot={snapshot} />}
        <footer className="page-footer"><span>Speak freely. Stay in your flow.</span><span>SARGOSH</span></footer>
      </div>
    </main>
    {settings && <SettingsDialog preferences={snapshot.preferences} onSave={savePreferences} onClose={() => setSettings(false)} />}
    {notice && <div className="toast" role="status"><Check size={16} /><span>{notice}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={15} /></button></div>}
    {deleting && <div className="modal-backdrop"><section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title"><h2 id="delete-title">Delete this dictation?</h2><p>This removes the entry from local history. Your accumulated insights stay unchanged.</p><div className="dialog-actions"><button className="button secondary" onClick={() => setDeleting(null)}>Keep dictation</button><button className="button danger" onClick={() => void removeEntry()}>Delete</button></div></section></div>}
  </div></div>;
}

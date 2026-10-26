import { StartupReady } from './StartupReady';
import { useAuth } from './auth';
import { SignIn } from './SignIn';
import { hasProfileName, type AccountUser } from '../shared/auth';
import { ProfileSetup } from './ProfileSetup';
import { NoticeToast } from './NoticeToast';
import { HistoryList } from './HistoryList';
import { ThemeMenu } from './ThemeMenu';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart3, Gauge, Mic, PanelLeftClose, PanelLeftOpen, Settings } from 'lucide-react';
import { EMPTY_SNAPSHOT, type Preferences, type Snapshot } from '../shared/types';
import { wordsPerMinute } from '../shared/insights';
import { DictationGuide } from './DictationGuide';
import { Onboarding } from './Onboarding';
import { setRecordingPreferences } from './audio/runtime';
import { Insights } from './Insights';
import { UsagePanel } from './UsagePanel';
import { RollingNumber } from './RollingNumber';
import { SettingsDialog } from './SettingsDialog';

export function App() {
  const auth = useAuth();
  if (window.sargosh?.authState && auth.phase !== 'signed-in') return <><StartupReady ready={auth.phase !== 'loading'} /><SignIn state={auth} /></>;
  if (window.sargosh?.authState && auth.user && !hasProfileName(auth.user)) return <><StartupReady /><ProfileSetup key={auth.user.id} user={auth.user} /></>;
  return <Workspace key={auth.user?.id ?? 'preview'} account={auth.user} />;
}
function Workspace({ account }: { account: AccountUser | null }) {
  const [page, setPage] = useState<'dictation' | 'insights' | 'usage'>('dictation');
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);
  const [snapshotReady, setSnapshotReady] = useState(!window.sargosh);
  const [settings, setSettings] = useState(false);
  const [notice, updateNotice] = useState({ message: '', id: 0 });
  const setNotice = useCallback((message: string) => updateNotice(current => ({ message, id: current.id + 1 })), []);
  const dismissNotice = useCallback(() => setNotice(''), [setNotice]);
  const refreshGeneration = useRef(0);
  const refresh = useCallback(async () => {
    if (!window.sargosh) return;
    const generation = ++refreshGeneration.current;
    try { const next = await window.sargosh.snapshot(); if (generation === refreshGeneration.current) setSnapshot(next); }
    catch { setNotice('Local history could not be opened. Check that the Python helper is running.'); }
    finally { if (generation === refreshGeneration.current) setSnapshotReady(true); }
  }, [setNotice]);
  useEffect(() => { void refresh(); return window.sargosh?.onHistoryChanged?.(() => { void refresh(); }); }, [refresh]);
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
  async function savePreferences(update: Partial<Preferences>) {
    try {
      if (!window.sargosh) { setSnapshot(current => ({ ...current, preferences: { ...current.preferences, ...update } })); return; }
      const preferences = await window.sargosh.preferences(update);
      setSnapshot(current => ({ ...current, preferences }));
    } catch {
      setNotice('Your preference could not be saved. Please try again.');
      if (update.shortcut !== undefined) throw new Error('Shortcut could not be saved. Please try again.');
    }
  }
  useEffect(() => { setRecordingPreferences(snapshot.preferences); }, [snapshot.preferences]);
  const collapsed = snapshot.preferences.collapsed;
  return <div className="app-frame"><StartupReady ready={snapshotReady} />
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
          <button title="Usage" aria-current={page === 'usage' ? 'page' : undefined} className={page === 'usage' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('usage')}><Gauge size={19} /><span className="sidebar-label">Usage</span></button>
        </nav>
      </div>
      <div className="sidebar-bottom">
        <button title="Settings" className="nav-item" onClick={() => setSettings(true)}><Settings size={19} /><span className="sidebar-label">Settings</span></button>
      </div>
    </aside>
    <main className="main-surface">
      <div className="main-scroll" tabIndex={0} aria-label="Page content">
      <div className="page-content">
        {page === 'dictation' ? <>
          <div className="page-heading"><div><p className="eyebrow">DICTATION</p><h1>{account?.firstName ? 'Welcome back, ' + account.firstName : 'Welcome to Sargosh'}</h1><p className="subtitle">Speak naturally. Make room for your thoughts.</p></div></div>
          <div className="dictation-stats">
            <section className="dictation-stat"><Mic size={19} strokeWidth={1.5} /><div><span className="stat-number"><RollingNumber value={snapshot.totalWords} /></span><span className="stat-label">total words dictated</span></div></section>
            <section className="dictation-stat"><BarChart3 size={19} strokeWidth={1.5} /><div><span className="stat-number"><RollingNumber value={wordsPerMinute(snapshot.totalWords, snapshot.totalDurationMs)} /><small>wpm</small></span><span className="stat-label">average dictation speed</span></div></section>
          </div>
          <DictationGuide preferences={snapshot.preferences} enabled={snapshotReady && !account?.onboardingRequired} />
          <HistoryList onNotice={setNotice} />
        </> : page === 'insights' ? <Insights snapshot={snapshot} /> : <>
          <div className="page-heading"><div><p className="eyebrow">USAGE</p><h1>Your dictation allowance</h1><p className="subtitle">See how much time you have left and when it resets.</p></div></div>
          <UsagePanel />
        </>}
        <footer className="page-footer"><span>Speak freely. Stay in your flow.</span><span>SARGOSH</span></footer>
      </div>
      </div>
    </main>
    {snapshotReady && account?.onboardingRequired && <Onboarding preferences={snapshot.preferences} onSave={savePreferences} />}
    {settings && <SettingsDialog preferences={snapshot.preferences} onSave={savePreferences} onClose={() => setSettings(false)} />}
    {notice.message && <NoticeToast key={notice.id} message={notice.message} onDismiss={dismissNotice} />}
  </div></div>;
}

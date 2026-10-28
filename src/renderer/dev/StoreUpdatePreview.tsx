import { useEffect, useState } from 'react';
import { BarChart3, Gauge, Mic, Moon, PanelLeftClose, PanelLeftOpen, Settings, Sun } from 'lucide-react';
import { SidebarLogo } from '../SidebarLogo';
import { StoreUpdateView } from '../StoreUpdateControl';
import type { StoreUpdateAction, StoreUpdateState } from '../../shared/store-update';

const initial:StoreUpdateState={phase:'available',progress:0,prompt:false,blocked:false,message:''};
export function StoreUpdatePreview() {
  const [state,setState]=useState<StoreUpdateState>(initial);
  const [theme,setTheme]=useState<'dark'|'light'>('dark');
  const [collapsed,setCollapsed]=useState(false);
  const [finished,setFinished]=useState(false);
  useEffect(()=>{
    const previous=document.documentElement.dataset.theme;
    document.documentElement.dataset.theme=theme;
    return()=>{if(previous)document.documentElement.dataset.theme=previous;else delete document.documentElement.dataset.theme;};
  },[theme]);
  useEffect(()=>{
    if(state.phase==='downloading'){
      const timer=setInterval(()=>setState(current=>{
        const progress=Math.min(1,current.progress+.06);
        return current.phase!=='downloading'?current:{...current,progress,phase:progress===1?'ready':'downloading'};
      }),350);
      return()=>clearInterval(timer);
    }
    if(state.phase==='installing'){
      const timer=setTimeout(()=>{
        setState(current=>({...current,phase:'idle',progress:0,message:'Preview complete. No app restart occurred.'}));setFinished(true);
      },1800);
      return()=>clearTimeout(timer);
    }
    if(state.phase==='checking'){
      const timer=setTimeout(()=>setState(current=>({...current,phase:'available',prompt:true})),650);
      return()=>clearTimeout(timer);
    }
  },[state.phase]);
  function action(value:StoreUpdateAction){
    if(value==='later'){setState(current=>({...current,prompt:false}));return;}
    if(state.blocked||['downloading','installing','checking'].includes(state.phase))return;
    setFinished(false);
    if(value==='download')setState(current=>({...current,phase:'downloading',progress:0,prompt:false,message:''}));
    else if(value==='install'&&state.phase==='ready')setState(current=>({...current,phase:'installing',prompt:false,message:''}));
    else if(value==='check')setState(current=>({...current,phase:'checking',prompt:false,message:''}));
  }
  const downloading=state.phase==='downloading';
  return <div className="app-frame update-preview">
    <header className="desktop-titlebar">
      <button className="icon-button sidebar-toggle" aria-label={collapsed?'Expand sidebar':'Collapse sidebar'} onClick={()=>setCollapsed(value=>!value)}>{collapsed?<PanelLeftOpen size={18}/>:<PanelLeftClose size={18}/>}</button>
      <span className="update-preview-badge">DEVELOPMENT PREVIEW</span>
      <div className="update-preview-theme" aria-label="Preview theme">
        <button aria-pressed={theme==='dark'} onClick={()=>setTheme('dark')}><Moon size={14}/>Dark</button>
        <button aria-pressed={theme==='light'} onClick={()=>setTheme('light')}><Sun size={14}/>Light</button>
      </div>
    </header>
    <div className={'app-shell'+(collapsed?' collapsed':'')}>
      <aside className="sidebar" aria-label="Preview sidebar">
        <div className="sidebar-top">
          <div className="brand"><SidebarLogo/><span className="sidebar-label"><span className="brand-wordmark">sargosh<span className="brand-period">.</span></span><span className="brand-caption">A little less typing.</span></span></div>
          <nav aria-label="Visual navigation sample">
            <div className="nav-item active"><Mic size={19}/><span className="sidebar-label">Dictation</span></div>
            <div className="nav-item"><BarChart3 size={19}/><span className="sidebar-label">Insights</span></div>
            <div className="nav-item"><Gauge size={19}/><span className="sidebar-label">Usage</span></div>
          </nav>
        </div>
        <div className="sidebar-bottom">
          <StoreUpdateView state={state} collapsed={collapsed} onAction={action} notice={state.message} onDismissNotice={()=>setState(current=>({...current,message:''}))}/>
          <div className="nav-item"><Settings size={19}/><span className="sidebar-label">Settings</span></div>
        </div>
      </aside>
      <main className="main-surface"><div className="main-scroll"><div className="page-content">
        <div className="page-heading"><div><p className="eyebrow">UPDATE PREVIEW ONLY</p><h1>Try the update experience.</h1><p className="subtitle">The real components, with a completely simulated update.</p></div></div>
        <section className="update-preview-panel" aria-labelledby="preview-controls">
          <h2 id="preview-controls">No downloads. No installation. No restart.</h2>
          <p>This page runs separately from Sargosh. It does not access your microphone, account, history or Microsoft Store. Windows’ own confirmation dialogs are not simulated.</p>
          <div className="update-preview-actions">
            <button className="button primary" onClick={()=>{setFinished(false);setState(current=>({...initial,blocked:current.blocked,prompt:true}));}}>Show update popup</button>
            <button className="button secondary" onClick={()=>{setFinished(false);setState({...initial});}}>Reset preview</button>
          </div>
          <label className="update-preview-busy"><input type="checkbox" checked={state.blocked} onChange={event=>setState(current=>({...current,blocked:event.target.checked}))}/>Simulate an active dictation</label>
          <p className="update-preview-help">This only tests the update safeguard. It does not start a recording.</p>
        </section>
        <section className="update-preview-panel update-preview-flow" aria-labelledby="preview-state">
          <p className="eyebrow">CURRENT PREVIEW STATE</p>
          <h2 id="preview-state">{finished?'Restart simulation complete':state.blocked?'Update controls paused':state.phase==='available'?'An update is available':downloading?'Downloading the update':state.phase==='ready'?'Ready to restart':state.phase==='installing'?'Simulating the restart':state.phase==='checking'?'Checking for updates':'Up to date'}</h2>
          <p>{finished?'The preview finished. The app was not restarted. Reset to try another theme or sidebar size.':state.blocked?'The update popup is deferred and the sidebar action is disabled until the simulated dictation ends.':state.phase==='available'?'Open the popup and choose Later to check the persistent sidebar option, or Update now to start the simulated download.':downloading?'Watch the sidebar progress. You can also try an interrupted download below.':state.phase==='ready'?'Click Restart to update in the sidebar. This will animate the next state and return to the preview without restarting anything.':state.phase==='installing'?'A short simulation is running. Nothing is being installed or restarted.':'Use Check for updates in the sidebar to replay the flow.'}</p>
          <div className="update-preview-steps" aria-label="Update stages">
            {['Available','Downloading','Ready to restart','Restart'].map((label,index)=><span key={label} className={index===(state.phase==='available'?0:downloading?1:state.phase==='ready'?2:3)?'current':''}>{String(index+1).padStart(2,'0')} {label}</span>)}
          </div>
          {downloading&&<div className="update-preview-actions">
            <button className="button secondary" onClick={()=>setState(current=>({...current,phase:'ready',progress:1}))}>Finish download</button>
            <button className="button secondary" onClick={()=>setState(current=>({...current,phase:'available',progress:0,message:'Update postponed. You can continue from the sidebar.'}))}>Simulate cancellation</button>
            <button className="button secondary" onClick={()=>setState(current=>({...current,phase:'available',progress:0,message:'Windows could not complete the update. Please try again.'}))}>Simulate download error</button>
          </div>}
        </section>
      </div></div></main>
    </div>
  </div>;
}

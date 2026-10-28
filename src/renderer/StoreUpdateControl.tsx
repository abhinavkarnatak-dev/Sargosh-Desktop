import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowDownToLine, RefreshCw, Sparkles, X } from 'lucide-react';
import { NO_STORE_UPDATES, type StoreUpdateAction, type StoreUpdateState } from '../shared/store-update';
import { NoticeToast } from './NoticeToast';
import { useModalDialog, useModalDismiss } from './modal';
import './StoreUpdateControl.css';

export function StoreUpdateControl({collapsed,allowPrompt=true}:{collapsed:boolean;allowPrompt?:boolean}) {
  const [state,setState]=useState<StoreUpdateState>(NO_STORE_UPDATES);
  const [notice,setNotice]=useState('');
  const lastMessage=useRef('');
  const apply=useCallback((next:StoreUpdateState)=>{
    setState(next);
    if(next.message&&next.message!==lastMessage.current)setNotice(next.message);
    lastMessage.current=next.message;
  },[]);
  useEffect(()=>{
    let active=true,eventReceived=false;
    const unsubscribe=window.sargosh?.onStoreUpdate?.(next=>{eventReceived=true;if(active)apply(next);});
    void window.sargosh?.storeUpdateState?.().then(next=>{if(active&&!eventReceived)apply(next);}).catch(()=>{});
    return()=>{active=false;unsubscribe?.();};
  },[apply]);
  const action=useCallback(async(value:StoreUpdateAction)=>{
    try {const next=await window.sargosh?.storeUpdateAction?.(value);if(next)apply(next);}
    catch{setNotice('The update could not start. Please try again.');}
  },[apply]);
  const dismissNotice=useCallback(()=>setNotice(''),[]);
  if(state.phase==='unsupported')return null;
  return <StoreUpdateView state={state} collapsed={collapsed} allowPrompt={allowPrompt} onAction={action}
    notice={notice} onDismissNotice={dismissNotice}/>;
}

export function StoreUpdateView({state,collapsed,allowPrompt=true,onAction,notice='',onDismissNotice=()=>{}}:{state:StoreUpdateState;collapsed:boolean;allowPrompt?:boolean;onAction:(action:StoreUpdateAction)=>void;notice?:string;onDismissNotice?:()=>void}) {
  const working=['checking','downloading','installing'].includes(state.phase);
  const ready=state.phase==='ready';
  const label=ready?'Restart to update':state.phase==='available'?'Update available':state.phase==='downloading'?`Downloading ${Math.round(state.progress*100)}%`:state.phase==='installing'?'Updating Sargosh…':state.phase==='checking'?'Checking for updates…':'Check for updates';
  const Icon=ready||working?RefreshCw:ArrowDownToLine;
  return <>
    <div className="store-update-control">
      <button className={'nav-item store-update-button'+(ready||state.phase==='available'?' has-update':'')} aria-label={label}
        data-tooltip={collapsed?(state.blocked?'Finish the current task before updating':label):''} data-tooltip-placement="right"
        disabled={working||state.blocked} onClick={()=>onAction(ready?'install':state.phase==='available'?'download':'check')}>
        <Icon size={18} className={working?'store-update-spin':undefined}/><span className="sidebar-label">{label}</span>
        {collapsed&&(ready||state.phase==='available')&&<span className="store-update-dot"/>}
      </button>
      {state.phase==='downloading'&&<progress aria-label="Update download progress" value={state.progress} max={1}/>}
    </div>
    {state.phase==='available'&&state.prompt&&!state.blocked&&allowPrompt&&<StoreUpdateDialog onAction={onAction}/>}
    {notice&&<NoticeToast message={notice} onDismiss={onDismissNotice} variant="info"/>}
  </>;
}

function StoreUpdateDialog({onAction}:{onAction:(action:StoreUpdateAction)=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);const id=useId();const intent=useRef<StoreUpdateAction>('later');const outsidePress=useRef(false);
  const {closing,dismiss}=useModalDismiss(()=>onAction(intent.current));
  useModalDialog(dialog);
  function choose(action:StoreUpdateAction){intent.current=action;dismiss();}
  function outside(element:HTMLDialogElement,x:number,y:number){const rect=element.getBoundingClientRect();return x<rect.left||x>rect.right||y<rect.top||y>rect.bottom;}
  return <dialog ref={dialog} className="store-update-dialog animated-modal" data-closing={closing} aria-labelledby={id}
    onPointerDown={event=>{outsidePress.current=event.target===event.currentTarget&&outside(event.currentTarget,event.clientX,event.clientY);}}
    onClick={event=>{if(outsidePress.current&&event.target===event.currentTarget&&outside(event.currentTarget,event.clientX,event.clientY))choose('later');outsidePress.current=false;}}
    onCancel={event=>{event.preventDefault();choose('later');}}>
    <button className="icon-button store-update-close" aria-label="Remind me later" disabled={closing} onClick={()=>choose('later')}><X size={18}/></button>
    <div className="store-update-mark"><Sparkles size={23}/></div>
    <p className="eyebrow">A LITTLE SOMETHING NEW</p>
    <h2 id={id}>An update is available.</h2>
    <p>Get the latest version of Sargosh. You can keep working while it downloads, then restart when you’re ready.</p>
    <div className="dialog-actions"><button className="button secondary" disabled={closing} onClick={()=>choose('later')}>Later</button><button className="button primary" disabled={closing} onClick={()=>choose('download')}>Update now</button></div>
  </dialog>;
}

import { useEffect, useState, type ReactNode } from 'react';
export function SettingsDetail({ open, id, children }: { open: boolean; id: string; children: ReactNode }) {
  const [present,setPresent]=useState(open);
  useEffect(()=>{
    if(open){setPresent(true);return;}
    const timer=setTimeout(()=>setPresent(false),220);
    return ()=>clearTimeout(timer);
  },[open]);
  return <div id={id} className="settings-detail" data-open={open} inert={!open} aria-hidden={!open}><div className="settings-detail-clip">{(open || present) && children}</div></div>;
}

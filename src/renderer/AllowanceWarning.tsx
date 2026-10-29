import { useCallback, useEffect, useRef } from 'react';
import { accountUsage, useAccountUsage } from './account-usage';
import { allowanceAlerts } from '../shared/usage';
import type { OverlayNotice } from '../shared/overlay-notice';
import { recordingBusy } from '../shared/recording';
import { cloudBusy, useDelivery, useRecording, useTranscription } from './audio/runtime';

export type AllowanceStatus='low'|'reached'|null;
export function AllowanceWarning({ accountId, enabled, onStatus }: { accountId:string; enabled:boolean; onStatus?:(status:AllowanceStatus)=>void }) {
 const audio=useRecording(),speech=useTranscription(),delivery=useDelivery();
 const busy=recordingBusy(audio)||speech.phase==='working'||delivery.phase==='working';
 const shared=useAccountUsage();
 const usage=shared.accountId===accountId?shared.usage:null;
 const previousBusy=useRef(false);
 const seen=useRef(new Set<string>());
 useEffect(()=>{if(!enabled)onStatus?.(null);},[enabled,onStatus]);
 const storageKey='sargosh.allowance-warnings:'+accountId;
 useEffect(()=>{
  accountUsage.reset(accountId);
  try { const saved=JSON.parse(sessionStorage.getItem(storageKey)??'[]') as unknown;seen.current=new Set(Array.isArray(saved)?saved.filter((id):id is string=>typeof id==='string'&&id.length<150).slice(0,8):[]); } catch { seen.current=new Set(); }
  return()=>accountUsage.reset();
 },[accountId,storageKey]);
 const dismiss=useCallback(()=>{void window.sargosh?.reportAllowanceWarning?.(null).catch(()=>{});},[]);
 useEffect(()=>{
  const completed=previousBusy.current&&!busy;previousBusy.current=busy;
  if(!enabled||busy||cloudBusy()||!window.sargosh?.usage)return;
  const refresh=()=>{if(!cloudBusy())void accountUsage.refresh();};
  void accountUsage.refresh(completed);
  const timer=window.setInterval(refresh,30000);
  window.addEventListener('focus',refresh);
  const release=window.sargosh.onHistoryChanged?.(refresh);
  return()=>{window.clearInterval(timer);window.removeEventListener('focus',refresh);release?.();};
 },[enabled,busy,accountId]);
 useEffect(()=>{
   if(!enabled||busy||cloudBusy()||!usage)return;
   const current=allowanceAlerts(usage),fresh=current.filter(alert=>!seen.current.has(alert.id));
   onStatus?.(current.some(alert=>alert.reached)?'reached':current.length?'low':null);
   seen.current=new Set(current.map(alert=>alert.id));
   try { sessionStorage.setItem(storageKey,JSON.stringify([...seen.current])); } catch { /* Warning delivery must not depend on storage. */ }
   if(!current.length){dismiss();return;}
   if(!fresh.length)return;
   const next:OverlayNotice={id:'allowance:'+current.map(alert=>alert.id).join('|'),kind:'warning',title:current.some(alert=>alert.reached)?'Allowance reached':'Allowance running low',message:current.map(alert=>alert.message).join(' ')};
   void window.sargosh?.reportAllowanceWarning?.(next).catch(()=>{});
 },[enabled,busy,usage,storageKey,dismiss,onStatus]);
 useEffect(()=>()=>{void window.sargosh?.reportAllowanceWarning?.(null).catch(()=>{});},[]);
 return null;
}

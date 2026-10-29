import { useEffect } from 'react';
import { accountUsage, useAccountUsage } from './account-usage';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import { allowanceAlerts } from '../shared/usage';
function remaining(limit:number,used:number){const seconds=Math.max(0,limit-used);return `${Math.floor(seconds/60)}m ${seconds%60}s`;}
export function UsagePanel(){
 const {usage,error,loading}=useAccountUsage();
 useEffect(()=>{if(window.sargosh?.usage)void accountUsage.refresh();},[]);
 const desktop=Boolean(window.sargosh?.usage);
 return <section className="usage-panel" aria-labelledby="usage-heading"><div className="usage-heading"><h3 id="usage-heading">Usage allowance</h3><button type="button" className="text-button" disabled={loading || !desktop} onClick={()=>void accountUsage.refresh()}>Refresh</button></div>
 {usage&&!error&&allowanceAlerts(usage).length>0&&<div className="allowance-alerts" role="status">{allowanceAlerts(usage).map(alert=><p key={alert.id} className={'allowance-alert'+(alert.reached?' allowance-alert-reached':'')}>{alert.reached?<AlertCircle size={16} aria-hidden="true"/>:<AlertTriangle size={16} aria-hidden="true"/>}<span>{alert.message}</span></p>)}</div>}
 {!desktop?<p className="inline-help" role="status">Open the Sargosh desktop app to view your account allowance.</p>:loading&&!usage?<p className="inline-help" role="status">Loading your allowance...</p>:error?<p className="inline-help" role="status">{error}</p>:usage?<><div className="usage-grid">{[{label:'Today',limit:usage.dailyLimitSeconds,used:usage.dailyUsedSeconds,reset:usage.dailyResetAt},{label:'This month',limit:usage.monthlyLimitSeconds,used:usage.monthlyUsedSeconds,reset:usage.monthlyResetAt}].map(period=><div key={period.label}><span>{period.label}</span><strong>{remaining(period.limit,period.used)} remaining</strong><progress aria-label={period.label+' dictation usage'} max={period.limit} value={Math.min(period.limit,period.used)}/><small>Of {period.limit/60} minutes. Resets {new Date(period.reset).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}.</small></div>)}</div><p className="inline-help">Usage is shared across devices signed into this account.</p></>:<p className="inline-help" role="status">Usage is not tracked by the local development server. Connect to the hosted backend to view your account allowance.</p>}</section>;
}

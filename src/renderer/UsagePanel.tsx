import { useEffect,useState } from 'react';
import type { AccountUsage } from '../shared/usage';
function remaining(limit:number,used:number){const seconds=Math.max(0,limit-used);return `${Math.floor(seconds/60)}m ${seconds%60}s`;}
export function UsagePanel(){
 const [usage,setUsage]=useState<AccountUsage|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{
  if(!window.sargosh?.usage)return;
  let alive=true;setLoading(true);setError('');
  void window.sargosh.usage().then(value=>{if(alive)setUsage(value);},()=>{if(alive)setError('Could not load your allowance. Please try again.');}).finally(()=>{if(alive)setLoading(false);});
  return()=>{alive=false;};
 },[revision]);
 if(!window.sargosh?.usage||(!loading&&!error&&!usage))return null;
 return <section className="usage-panel" aria-labelledby="usage-heading"><div className="usage-heading"><h3 id="usage-heading">Usage allowance</h3><button type="button" className="text-button" disabled={loading} onClick={()=>setRevision(value=>value+1)}>Refresh</button></div>
 {loading?<p className="inline-help" role="status">Loading your allowance...</p>:error?<p className="inline-help" role="status">{error}</p>:usage?<><div className="usage-grid">{[{label:'Today',limit:usage.dailyLimitSeconds,used:usage.dailyUsedSeconds,reset:usage.dailyResetAt},{label:'This month',limit:usage.monthlyLimitSeconds,used:usage.monthlyUsedSeconds,reset:usage.monthlyResetAt}].map(period=><div key={period.label}><span>{period.label}</span><strong>{remaining(period.limit,period.used)} remaining</strong><progress aria-label={period.label+' dictation usage'} max={period.limit} value={Math.min(period.limit,period.used)}/><small>Of {period.limit/60} minutes. Resets {new Date(period.reset).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}.</small></div>)}</div><p className="inline-help">Usage is shared across devices signed into this account.</p></>:null}</section>;
}

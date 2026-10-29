export interface AccountUsage {
 enabled: boolean; dailyLimitSeconds: number; monthlyLimitSeconds: number;
 dailyUsedSeconds: number; monthlyUsedSeconds: number; dailyResetAt: string; monthlyResetAt: string;
}
export function validAccountUsage(value: unknown): value is AccountUsage {
 const x=value as AccountUsage|null;
 return Boolean(x&&typeof x.enabled==='boolean'&&[x.dailyLimitSeconds,x.monthlyLimitSeconds,x.dailyUsedSeconds,x.monthlyUsedSeconds].every(n=>Number.isFinite(n)&&n>=0)&&Number.isFinite(Date.parse(x.dailyResetAt))&&Number.isFinite(Date.parse(x.monthlyResetAt)));
}
export interface AllowanceAlert { id:string; message:string; reached:boolean }
export function allowanceAlerts(usage:AccountUsage):AllowanceAlert[]{
 if(!usage.enabled||!validAccountUsage(usage))return [];
 return ([['daily',usage.dailyLimitSeconds,usage.dailyUsedSeconds,usage.dailyResetAt],['monthly',usage.monthlyLimitSeconds,usage.monthlyUsedSeconds,usage.monthlyResetAt]] as const).flatMap(([period,limit,used,reset])=>{
  const seconds=Math.max(0,limit-used);
  if(seconds>60)return [];
  const reached=seconds<1;
  return [{id:period+':'+reset+':'+(reached?'reached':'low'),reached,message:reached?'You have reached your '+period+' allowance.':'You have 1 minute or less left in your '+period+' allowance.'}];
 });
}

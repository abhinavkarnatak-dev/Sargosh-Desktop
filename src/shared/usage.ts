export interface AccountUsage {
 enabled: boolean; dailyLimitSeconds: number; monthlyLimitSeconds: number;
 dailyUsedSeconds: number; monthlyUsedSeconds: number; dailyResetAt: string; monthlyResetAt: string;
}
export function validAccountUsage(value: unknown): value is AccountUsage {
 const x=value as AccountUsage|null;
 return Boolean(x&&typeof x.enabled==='boolean'&&[x.dailyLimitSeconds,x.monthlyLimitSeconds,x.dailyUsedSeconds,x.monthlyUsedSeconds].every(n=>Number.isFinite(n)&&n>=0)&&Number.isFinite(Date.parse(x.dailyResetAt))&&Number.isFinite(Date.parse(x.monthlyResetAt)));
}

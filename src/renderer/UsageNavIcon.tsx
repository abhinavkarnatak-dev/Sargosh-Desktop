import { AlertCircle, AlertTriangle } from 'lucide-react';
import type { AllowanceStatus } from './AllowanceWarning';
export function UsageNavIcon({status}:{status:AllowanceStatus}){
 if(!status)return null;
 return <span className={'usage-nav-alert usage-nav-alert-'+status} role="img" aria-label={status==='reached'?'Allowance reached':'Allowance running low'}>{status==='reached'?<AlertCircle size={16} aria-hidden="true"/>:<AlertTriangle size={16} aria-hidden="true"/>}</span>;
}

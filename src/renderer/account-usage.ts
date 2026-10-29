import { useSyncExternalStore } from 'react';
import { validAccountUsage, type AccountUsage } from '../shared/usage';
interface UsageState { accountId:string|null; usage:AccountUsage|null; error:string; loading:boolean }
export class AccountUsageStore {
 private state:UsageState={accountId:null,usage:null,error:'',loading:false};
 private listeners=new Set<()=>void>();
 private generation=0;
 private pending?:Promise<void>;
 private queued=false;
 constructor(private fetchUsage:()=>Promise<AccountUsage|null>){}
 getState=()=>this.state;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private publish(change:Partial<UsageState>){this.state={...this.state,...change};for(const listener of this.listeners)listener();}
 reset(accountId:string|null=null){this.generation++;this.pending=undefined;this.queued=false;this.publish({accountId,usage:null,error:'',loading:false});}
 refresh=(afterCurrent=false):Promise<void>=>{
  if(this.pending){if(afterCurrent)this.queued=true;return this.pending;}
  const generation=this.generation;
  this.publish({loading:true,error:''});
  const work=async()=>{
   do {
    this.queued=false;
    try {
     const usage=await this.fetchUsage();
     if(generation!==this.generation)return;
     if(usage!==null&&!validAccountUsage(usage))throw new Error('Invalid allowance');
     this.publish({usage,error:''});
    }catch{if(generation===this.generation)this.publish({error:'Could not load your allowance. Please try again.'});}
   }while(generation===this.generation&&this.queued);
  };
  const pending=work().finally(()=>{if(generation===this.generation){this.pending=undefined;this.publish({loading:false});}});
  this.pending=pending;return pending;
 };
}
export const accountUsage=new AccountUsageStore(()=>window.sargosh?.usage?.()??Promise.resolve(null));
export const useAccountUsage=()=>useSyncExternalStore(accountUsage.subscribe,accountUsage.getState);

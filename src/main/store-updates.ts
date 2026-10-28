import { NO_STORE_UPDATES, type StoreBridge, type StoreUpdateAction, type StoreUpdateState } from '../shared/store-update';

// Store operations never enter the dictation transport or provider pipeline.
export class StoreUpdates {
  private state:StoreUpdateState;
  private operation=false;
  private notified=false;
  private disposed=false;
  private lastBlocked?:boolean;
  private aumid?:string;
  private initial?:ReturnType<typeof setTimeout>;
  private interval?:ReturnType<typeof setInterval>;
  constructor(private enabled:boolean,private bridge:StoreBridge,private busy:()=>boolean,
    private changed:(state:StoreUpdateState)=>void,private prepareInstall:()=>Promise<void>,
    private endInstall:()=>Promise<void>,private restart:(aumid:string)=>void) {
    this.state={...NO_STORE_UPDATES,phase:enabled?'idle':'unsupported'};
  }
  get installing(){return this.state.phase==='installing';}
  snapshot():StoreUpdateState{return {...this.state,blocked:this.busy()};}
  activityChanged(){if(this.enabled&&!this.disposed){const state=this.snapshot();if(state.blocked!==this.lastBlocked){this.lastBlocked=state.blocked;this.changed(state);}}}
  private set(update:Partial<StoreUpdateState>){if(this.disposed)return;this.state={...this.state,...update};this.lastBlocked=this.busy();this.changed(this.snapshot());}
  start(){
    if(!this.enabled||this.interval||this.disposed)return;
    this.initial=setTimeout(()=>void this.action('check'),30000);
    this.interval=setInterval(()=>void this.action('check'),15*60*1000);
    this.initial.unref?.();this.interval.unref?.();
  }
  async action(action:StoreUpdateAction):Promise<StoreUpdateState>{
    if(!this.enabled||this.disposed)return this.snapshot();
    if(action==='later'){this.set({prompt:false});return this.snapshot();}
    if(this.operation)return this.snapshot();
    if(this.busy()){this.set({message:'Finish the current dictation or account task before updating.'});return this.snapshot();}
    if(action==='check'&&this.state.phase==='ready')return this.snapshot();
    if(action==='download'&&!['available','error'].includes(this.state.phase))return this.snapshot();
    if(action==='install'&&this.state.phase!=='ready')return this.snapshot();
    const previous=this.state.phase;
    this.operation=true;
    this.set({phase:action==='check'?'checking':action==='download'?'downloading':'installing',prompt:false,message:'',...(action==='download'?{progress:0}:{})});
    try {
      if(action==='install'){
        if(!this.aumid)throw new Error('Store package identity unavailable.');
        await this.prepareInstall();
        if(this.busy())throw new Error('busy');
      }
      if(this.disposed)return this.snapshot();
      const result=await this.bridge.call(action,fraction=>{
        if(action==='download'&&Number.isFinite(fraction))this.set({progress:Math.max(this.state.progress,Math.min(1,Math.max(0,fraction)))});
      });
      if(this.disposed)return this.snapshot();
      if(result.aumid&&/^AbhinavKarnatak\.Sargosh_[a-z0-9]+!Sargosh$/.test(result.aumid))this.aumid=result.aumid;
      if(!result.ok){
        if(result.code==='UNSUPPORTED'){this.enabled=false;this.set({...NO_STORE_UPDATES});return this.snapshot();}
        if(result.code==='NOT_DOWNLOADED'){this.set({phase:'available',progress:0,message:'Download the update again before installing.'});return this.snapshot();}
        this.set({phase:action==='install'?'ready':previous==='available'||action==='download'?'available':'error',
          message:result.code==='CANCELLED'?'Update postponed. You can continue from the sidebar.':'Windows could not complete the update. Please try again.'});
        return this.snapshot();
      }
      if(action==='install'){
        if(result.state!=='installed'||!this.aumid)throw new Error('invalid installation result');
        this.restart(this.aumid);
      }else if(result.downloaded){if(!this.aumid)throw new Error('Store package identity unavailable.');this.set({phase:'ready',progress:1});}
      else if(result.available){
        const prompt=!this.notified;this.notified=true;this.set({phase:'available',prompt});
      }else this.set({phase:'idle',progress:0,message:action==='download'?'Sargosh is already up to date.':''});
    }catch{
      this.set({phase:action==='install'?'ready':action==='download'?'available':'error',message:this.busy()?'Finish the current dictation before updating.':'The Store update service is unavailable. Please try again.'});
    }finally{
      if(action==='install'&&!this.disposed&&this.state.phase!=='installing')await this.endInstall().catch(()=>{});
      this.operation=false;
    }
    return this.snapshot();
  }
  dispose(){this.disposed=true;clearTimeout(this.initial);clearInterval(this.interval);this.bridge.stop();}
}

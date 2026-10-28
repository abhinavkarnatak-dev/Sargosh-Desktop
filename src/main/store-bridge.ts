import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { StoreBridge, StoreReply } from '../shared/store-update';

// A private stdio channel to the packaged, fixed-path Windows Store bridge.
export class NativeStoreBridge implements StoreBridge {
  private child?:ChildProcessWithoutNullStreams;
  private pending?:{id:string;resolve:(reply:StoreReply)=>void;reject:(error:Error)=>void;progress?:(value:number)=>void;timer:ReturnType<typeof setTimeout>};
  constructor(private executable:string,private windowHandle:()=>string){}
  private launch(){
    if(this.child)return this.child;
    const child=spawn(this.executable,[],{stdio:'pipe',windowsHide:true});this.child=child;
    // Do not forward arbitrary native error messages or Store payloads to the renderer/logs.
    child.stderr.resume();
    const lines=createInterface({input:child.stdout});
    lines.on('line',line=>{
      if(line.length>8192){this.stop();return;}
      try {
        const data=JSON.parse(line);const pending=this.pending;if(!pending||data.id!==pending.id)return;
        if(data.type==='progress'){if(typeof data.progress==='number'&&Number.isFinite(data.progress))pending.progress?.(data.progress);return;}
        if(typeof data.ok!=='boolean')return;
        this.pending=undefined;clearTimeout(pending.timer);
        pending.resolve({ok:data.ok,code:typeof data.code==='string'?data.code:undefined,available:data.available===true,downloaded:data.downloaded===true,
          state:['available','downloaded','installed'].includes(data.state)?data.state:undefined,
          aumid:typeof data.aumid==='string'&&/^AbhinavKarnatak\.Sargosh_[a-z0-9]+!Sargosh$/.test(data.aumid)?data.aumid:undefined});
      }catch{this.stop();}
    });
    const closed=()=>{lines.close();if(this.child===child){this.child=undefined;this.fail();}};
    child.once('error',closed);child.once('exit',closed);
    child.stdin.on('error',()=>this.stop());
    return child;
  }
  call(action:'check'|'download'|'install',progress?:(fraction:number)=>void):Promise<StoreReply>{
    if(this.pending)return Promise.reject(new Error('Store operation in progress.'));
    if(action==='install'&&!this.child)return Promise.resolve({ok:false,code:'NOT_DOWNLOADED'});
    return new Promise((resolve,reject)=>{
      const id=randomUUID();
      const timer=setTimeout(()=>this.stop(),action==='check'?45000:30*60*1000);
      this.pending={id,resolve,reject,progress,timer};
      try {
        const handle=this.windowHandle();if(!/^[1-9]\d{0,19}$/.test(handle))throw new Error('Window unavailable.');
        const child=this.launch();child.stdin.write(JSON.stringify({id,action,hwnd:handle})+'\n',error=>{if(error)this.stop();});
      }catch{this.stop();}
    });
  }
  private fail(){const pending=this.pending;this.pending=undefined;if(pending){clearTimeout(pending.timer);pending.reject(new Error('Store bridge stopped.'));}}
  stop(){const child=this.child;this.child=undefined;child?.kill();this.fail();}
}

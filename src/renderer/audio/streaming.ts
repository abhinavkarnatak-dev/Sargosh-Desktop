import type { DesktopBridge } from '../../shared/types';
import type { SpeechLanguage, Transcript } from '../../shared/transcription';
import { STREAM_BYTES_PER_SECOND, STREAM_MAX_BUFFER } from '../../shared/streaming';

interface Session {
  id:string;language:SpeechLanguage;cleanup:boolean;practice:boolean;chunks:ArrayBuffer[];buffered:number;sent:number;limit:number;
  chain:Promise<void>;opening?:Promise<void>;unsupported:boolean;error?:Error;cancelled:boolean;limited:boolean;
}
// One owner controls recording chunks and the post-stop result. Never replay a partially sent stream.
export class StreamingCapture {
  private session?:Session;
  constructor(private bridge:()=>DesktopBridge|undefined,private onLimit:()=>void){}
  prepare(id:string,language:SpeechLanguage,cleanup:boolean,practice=false){
    this.cancel();
    if(!this.bridge()?.startStream)return;
    this.session={id,language,cleanup,practice,chunks:[],buffered:0,sent:0,limit:(practice?20:300)*STREAM_BYTES_PER_SECOND,chain:Promise.resolve(),unsupported:false,cancelled:false,limited:false};
  }
  activate(id:string){
    const s=this.session;if(!s||s.id!==id||s.opening||s.cancelled)return;
    s.opening=this.bridge()!.startStream!({requestId:id,traceId:id,language:s.language,cleanup:s.cleanup,...(s.practice?{practice:true}:{})}).then(async result=>{
      if(s.cancelled){void this.bridge()?.cancelStream?.(id);return;}
      if(!result.ok){if(result.code==='STREAM_UNSUPPORTED'){s.unsupported=true;s.chunks=[];s.buffered=0;await this.bridge()?.cancelStream?.(id);return;}throw Object.assign(new Error(result.message),{code:result.code});}
      const seconds=(result as {maxAudioSeconds?:number}).maxAudioSeconds;
      if(seconds)s.limit=seconds*STREAM_BYTES_PER_SECOND;
    }).catch(error=>this.fail(s,error));
    this.drain(s);
  }
  push(id:string,audio:ArrayBuffer){
    const s=this.session;if(!s||s.id!==id||s.cancelled||s.unsupported||s.error||s.limited)return;
    s.chunks.push(audio);s.buffered+=audio.byteLength;
    if(s.buffered>STREAM_MAX_BUFFER){this.fail(s,new Error('The live connection could not keep up. Retry the saved recording.'));return;}
    this.drain(s);
  }
  private drain(s:Session){
    if(!s.opening)return;
    s.chain=s.chain.then(async()=>{
      await s.opening;
      while(!s.cancelled&&!s.unsupported&&!s.error&&s.chunks.length){
        let chunk=s.chunks.shift()!;s.buffered-=chunk.byteLength;
        const remaining=s.limit-s.sent;
        if(remaining<chunk.byteLength)chunk=chunk.slice(0,remaining);
        if(chunk.byteLength){if(!await this.bridge()!.streamChunk!(s.id,chunk))throw new Error('The live audio connection was interrupted. Retry the saved recording.');s.sent+=chunk.byteLength;}
        if(s.sent>=s.limit){s.limited=true;s.chunks=[];s.buffered=0;this.onLimit();break;}
      }
    }).catch(error=>this.fail(s,error));
  }
  private fail(s:Session,error:unknown){if(s.error)return;s.error=error instanceof Error?error:new Error('Live dictation failed. Retry the saved recording.');s.chunks=[];s.buffered=0;void this.bridge()?.cancelStream?.(s.id);}
  handles(id:string){return this.session?.id===id;}
  async finish(id:string,signal:AbortSignal):Promise<Transcript|null>{
    const s=this.session;if(!s||s.id!==id)return null;
    const cancel=()=>this.cancel();signal.addEventListener('abort',cancel,{once:true});
    try{
      if(signal.aborted){this.cancel();throw new Error('Dictation cancelled.');}
      await s.opening;await s.chain;
      if(s.cancelled||signal.aborted)throw new Error('Dictation cancelled.');
      if(s.unsupported)return null;
      if(s.error)throw s.error;
      const result=await this.bridge()!.finishStream!(id);
      if(s.cancelled||signal.aborted)throw new Error('Dictation cancelled.');
      if(!result.ok)throw Object.assign(new Error(result.message),{code:result.code});
      return result.result;
    }finally{signal.removeEventListener('abort',cancel);if(this.session===s)this.session=undefined;}
  }
  cancel(){const s=this.session;if(!s)return;s.cancelled=true;s.chunks=[];s.buffered=0;void this.bridge()?.cancelStream?.(s.id);this.session=undefined;}
}

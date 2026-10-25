import { spawn } from 'node:child_process';
export class AudioError extends Error { constructor(public code:string,message:string,public status=400){super(message);} }
export interface NormalizedAudio { audio:Buffer; durationSeconds:number }
export function normalizeAudio(input:Buffer,signal:AbortSignal,executable='ffmpeg'):Promise<NormalizedAudio>{
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(new AudioError('CANCELLED','Recording cancelled.',499));return;}
  const child=spawn(executable,['-hide_banner','-loglevel','error','-protocol_whitelist','pipe','-format_whitelist','matroska,webm,ogg,wav,mp3,mov','-i','pipe:0','-map','0:a:0','-vn','-sn','-dn','-ac','1','-ar','16000','-t','301','-c:a','pcm_s16le','-f','s16le','pipe:1'],{windowsHide:true,stdio:['pipe','pipe','ignore'],shell:false});
  const chunks:Buffer[]=[];let bytes=0,settled=false;
  const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);if(error){child.kill();reject(error);return;}
   if(!bytes||bytes%2){reject(new AudioError('INVALID_AUDIO','This recording has no usable audio.'));return;}
   const pcm=Buffer.concat(chunks);const wav=Buffer.alloc(44+pcm.length);wav.write('RIFF');wav.writeUInt32LE(36+pcm.length,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(pcm.length,40);pcm.copy(wav,44);resolve({audio:wav,durationSeconds:Math.ceil(pcm.length/32000)});
  };
  const cancel=()=>finish(new AudioError('CANCELLED','Recording cancelled.',499));
  const timer=setTimeout(()=>finish(new AudioError('AUDIO_TIMEOUT','The recording took too long to validate.',408)),20000);
  signal.addEventListener('abort',cancel,{once:true});
  child.stdout.on('data',(part:Buffer)=>{bytes+=part.length;if(bytes>300*32000){finish(new AudioError('RECORDING_LIMIT','A recording can be at most 5 minutes.'));return;}chunks.push(part);});
  child.stdin.on('error',()=>{});child.on('error',()=>finish(new AudioError('AUDIO_UNAVAILABLE','Audio validation is unavailable. Please try later.',503)));
  child.on('close',code=>{if(code!==0)finish(new AudioError('INVALID_AUDIO','The recording is not a supported audio file.'));else finish();});
  child.stdin.end(input);
 });
}

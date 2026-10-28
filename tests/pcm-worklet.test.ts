import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

for(const sampleRate of [16000,44100,48000])it(`resamples ${sampleRate} Hz into ordered 16 kHz little-endian PCM without playing audio`,()=>{
  let Worklet:any;const messages:any[]=[];
  runInNewContext(readFileSync('src/renderer/audio/pcm-worklet.js','utf8'),{
    sampleRate,AudioWorkletProcessor:class{port={onmessage:undefined,postMessage:(x:any)=>messages.push(x)};},
    registerProcessor:(_name:string,value:any)=>{Worklet=value;},ArrayBuffer,DataView
  });
  const worklet=new Worklet();worklet.port.onmessage({data:'start'});
  const input=new Float32Array(sampleRate).fill(.5);
  for(let offset=0;offset<input.length;offset+=128)worklet.process([[input.subarray(offset,Math.min(input.length,offset+128))]]);
  worklet.port.onmessage({data:'finish'});
  const buffers=messages.filter(x=>x.audio).map(x=>x.audio as ArrayBuffer);
  expect(buffers.reduce((n,x)=>n+x.byteLength,0)).toBe(32000);
  expect(new DataView(buffers[0]).getInt16(0,true)).toBe(16384);
  expect(messages.at(-1)).toEqual({finished:true});
  const count=messages.length;worklet.process([[input]]);expect(messages).toHaveLength(count);
});

it('flushes a short final audio chunk before acknowledging finish',()=>{
  let Worklet:any;const messages:any[]=[];
  runInNewContext(readFileSync('src/renderer/audio/pcm-worklet.js','utf8'),{sampleRate:48000,AudioWorkletProcessor:class{port={onmessage:undefined,postMessage:(x:any)=>messages.push(x)};},registerProcessor:(_name:string,value:any)=>{Worklet=value;},ArrayBuffer,DataView});
  const worklet=new Worklet();worklet.port.onmessage({data:'start'});worklet.process([[new Float32Array(300).fill(-1)]]);
  expect(messages).toHaveLength(0);worklet.port.onmessage({data:'finish'});
  expect(messages[0].audio.byteLength).toBe(200);expect(new DataView(messages[0].audio).getInt16(0,true)).toBe(-32768);expect(messages[1]).toEqual({finished:true});
});

import { it,expect } from 'vitest';
import ffmpeg from 'ffmpeg-static';
import { normalizeAudio } from '../src/server/audio';
function wav(seconds:number,channels=2){
 const pcm=Buffer.alloc(seconds*16000*2*channels);const result=Buffer.alloc(44+pcm.length);
 result.write('RIFF');result.writeUInt32LE(36+pcm.length,4);result.write('WAVEfmt ',8);result.writeUInt32LE(16,16);result.writeUInt16LE(1,20);result.writeUInt16LE(channels,22);result.writeUInt32LE(16000,24);result.writeUInt32LE(32000*channels,28);result.writeUInt16LE(2*channels,32);result.writeUInt16LE(16,34);result.write('data',36);result.writeUInt32LE(pcm.length,40);pcm.copy(result,44);return result;
}
it('decodes and measures real stereo audio as mono PCM',async()=>{
 const result=await normalizeAudio(wav(2),new AbortController().signal,ffmpeg!);expect(result.durationSeconds).toBe(2);expect(result.audio.readUInt16LE(22)).toBe(1);expect(result.audio.readUInt32LE(24)).toBe(16000);expect(result.audio.length).toBe(44+2*32000);
},10000);
it('rejects malformed audio and overlong recordings before provider access',async()=>{
 await expect(normalizeAudio(Buffer.from('not audio'),new AbortController().signal,ffmpeg!)).rejects.toMatchObject({code:'INVALID_AUDIO'});
 await expect(normalizeAudio(wav(301,1),new AbortController().signal,ffmpeg!)).rejects.toMatchObject({code:'RECORDING_LIMIT'});
},10000);
it('cancels validation and reports a missing decoder safely',async()=>{
 const abort=new AbortController();abort.abort();await expect(normalizeAudio(wav(1),abort.signal,ffmpeg!)).rejects.toMatchObject({code:'CANCELLED'});
 await expect(normalizeAudio(wav(1),new AbortController().signal,'nonexistent-sargosh-decoder')).rejects.toMatchObject({code:'AUDIO_UNAVAILABLE'});
});

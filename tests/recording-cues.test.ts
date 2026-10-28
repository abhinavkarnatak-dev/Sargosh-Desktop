import { expect, it, vi } from 'vitest';
import { createCuePlayer, RecordingCues } from '../src/renderer/audio/recording-cues';

it('plays one start and stop per recording across hold/hands-free sessions and repeated native updates',()=>{
  const play=vi.fn();const cues=new RecordingCues(play);
  for(const id of ['hold','hands-free','hold-again']){
    cues.observe({sessionId:id,phase:'opening'});
    cues.observe({sessionId:id,phase:'opening'});
    cues.observe({sessionId:id,phase:'recording'});
    cues.observe({sessionId:id,phase:'recording'});
    cues.observe({sessionId:id,phase:'finishing'});
    expect(play.mock.calls.at(-1)).toEqual(['start']);
    cues.observe({sessionId:id,phase:'ready'});
    cues.observe({sessionId:id,phase:'ready'});
    cues.observe({sessionId:null,phase:'idle'});
  }
  expect(play.mock.calls.map(x=>x[0])).toEqual(['start','stop','start','stop','start','stop']);
});

it('does not announce recording when opening fails or an unaccepted shortcut is cancelled',()=>{
  const play=vi.fn();const cues=new RecordingCues(play);
  cues.observe({sessionId:'permission',phase:'opening'});cues.observe({sessionId:'permission',phase:'failed'});
  cues.observe({sessionId:'pending',phase:'opening'});cues.observe({sessionId:'pending',phase:'cancelled'});
  expect(play).not.toHaveBeenCalled();
});

it.each(['cancelled','failed'] as const)('plays stop once when an active recording is %s',phase=>{
  const play=vi.fn();const cues=new RecordingCues(play);
  cues.observe({sessionId:'id',phase:'recording'});cues.observe({sessionId:'id',phase});cues.observe({sessionId:'id',phase});cues.observe({sessionId:null,phase:'idle'});
  expect(play.mock.calls.map(x=>x[0])).toEqual(['start','stop']);
});

it('preloads local files, reuses players, and interrupts the previous cue on a quick finish',()=>{
  const sounds=[{preload:'' as HTMLAudioElement['preload'],currentTime:5,pause:vi.fn(),play:vi.fn(async()=>{})},{preload:'' as HTMLAudioElement['preload'],currentTime:5,pause:vi.fn(),play:vi.fn(async()=>{})}];
  let index=0;const create=vi.fn(()=>sounds[index++]);const play=createCuePlayer(create);
  expect(create.mock.calls).toHaveLength(2);expect(sounds.every(x=>x.preload==='auto')).toBe(true);
  play('start');play('stop');play('start');
  expect(sounds[0].play).toHaveBeenCalledTimes(2);expect(sounds[1].play).toHaveBeenCalledOnce();expect(sounds[0].pause).toHaveBeenCalledOnce();expect(sounds[1].pause).toHaveBeenCalledTimes(2);expect(sounds[0].currentTime).toBe(0);
});

it('handles browser playback rejection without blocking or throwing',async()=>{
  const play=createCuePlayer(()=>({preload:'',currentTime:0,pause:()=>{},play:()=>Promise.reject(new Error('Output blocked'))}));
  expect(()=>play('start')).not.toThrow();expect(()=>play('stop')).not.toThrow();await Promise.resolve();
});

it('keeps recording usable if an audio player cannot be created',()=>{
 const play=createCuePlayer(()=>{throw new Error('No playback device');});
 expect(()=>{play('start');play('stop');}).not.toThrow();
});

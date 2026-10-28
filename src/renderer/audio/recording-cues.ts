import startURL from './sounds/start.mp3?url';
import stopURL from './sounds/stop.mp3?url';
import type { RecordingState } from '../../shared/recording';

type Cue = 'start' | 'stop';
type CueAudio = Pick<HTMLAudioElement, 'preload' | 'currentTime' | 'pause' | 'play'>;

export function createCuePlayer(makeAudio: (url:string)=>CueAudio|null = url=>typeof Audio==='undefined'?null:new Audio(url)) {
  const create=(url:string)=>{try{return makeAudio(url);}catch{return null;}};
  const sounds = { start: create(startURL), stop: create(stopURL) };
  for(const sound of Object.values(sounds))if(sound)sound.preload='auto';
  return (cue:Cue) => {
    // Cues are feedback only. Playback failure must never interrupt recording or delivery.
    try {
      const sound=sounds[cue],other=sounds[cue==='start'?'stop':'start'];
      other?.pause();
      if(!sound)return;
      sound.currentTime=0;
      void sound.play().catch(()=>{});
    } catch { /* Missing/muted audio output does not affect the microphone. */ }
  };
}

export class RecordingCues {
  private activeId:string|null=null;
  private lastStarted:string|null=null;
  constructor(private play:(cue:Cue)=>void){}
  observe(state:Pick<RecordingState,'sessionId'|'phase'>) {
    if(state.phase==='recording'&&state.sessionId&&state.sessionId!==this.lastStarted){
      this.activeId=state.sessionId;this.lastStarted=state.sessionId;this.play('start');
    }
    // 'finishing' still collects the last audio. Wait until the microphone has stopped.
    if(this.activeId && ['ready','cancelled','failed','idle'].includes(state.phase) &&
      (state.sessionId===this.activeId || state.sessionId===null)){
      this.activeId=null;this.play('stop');
    }
  }
}

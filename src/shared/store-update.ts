export type StoreUpdatePhase = 'unsupported' | 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';
export interface StoreUpdateState {
  phase: StoreUpdatePhase;
  progress: number;
  prompt: boolean;
  blocked: boolean;
  message: string;
}
export type StoreUpdateAction = 'check' | 'download' | 'later' | 'install';
export const NO_STORE_UPDATES: StoreUpdateState = {phase:'unsupported',progress:0,prompt:false,blocked:false,message:''};
export interface StoreReply { ok:boolean; code?:string; available?:boolean; downloaded?:boolean; state?:'available'|'downloaded'|'installed'; aumid?:string }
export interface StoreBridge {
  call(action:'check'|'download'|'install',progress?:(fraction:number)=>void):Promise<StoreReply>;
  stop():void;
}

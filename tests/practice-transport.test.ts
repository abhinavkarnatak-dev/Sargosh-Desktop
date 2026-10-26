import { expect,it,vi } from 'vitest';
import { transcriptionTransport } from '../src/renderer/audio/transcription-transport';
import { cleanupTransport } from '../src/renderer/audio/cleanup-transport';
import { setPracticeSession } from '../src/renderer/audio/practice';
import { transcribeViaLocalAPI } from '../src/shared/local-api';
it('uses the same practice ID for speech and cleanup without affecting later real dictation',async()=>{
 const transcribe=vi.fn(async(_request:unknown)=>({ok:true,result:{text:'Hello.',language:'en',model:'nova-3',durationMs:1000,confidence:1}}));
 const cleanup=vi.fn(async(_request:unknown)=>({ok:true,result:{text:'Hello.',model:'gemini-3.5-flash-lite'}}));
 vi.stubGlobal('window',{sargosh:{transcribeAudio:transcribe,cleanupTranscript:cleanup,practiceTranscribeAudio:transcribe,practiceCleanupTranscript:cleanup,cancelTranscription:async()=>{}}});
 const signal=new AbortController().signal;
 try{
  setPracticeSession('practice-session');await transcriptionTransport(new Blob(['audio'],{type:'audio/webm'}),'en','speech-id',signal);await cleanupTransport('Hello.','en','cleanup-id',signal);
  expect(transcribe.mock.calls[0][0]).toMatchObject({requestId:'practice-session',practice:true});expect(cleanup.mock.calls[0][0]).toMatchObject({requestId:'practice-session',practice:true});
  setPracticeSession(null);await cleanupTransport('Hello.','en','normal-id',signal);expect(cleanup.mock.calls[1][0]).toMatchObject({requestId:'normal-id'});expect(cleanup.mock.calls[1][0]).not.toHaveProperty('practice');
 }finally{setPracticeSession(null);vi.unstubAllGlobals();}
});
it('never falls back to the normal paid endpoint when an old backend lacks practice routes',async()=>{
 const fetcher=vi.fn<typeof fetch>(async url=>String(url).endsWith('/health')?Response.json({status:'ok',service:'sargosh-api'}):Response.json({code:'NOT_FOUND',message:'Unavailable'},{status:404}));
 await expect(transcribeViaLocalAPI({requestId:'practice',practice:true,audio:new ArrayBuffer(2),mimeType:'audio/webm',language:'en'},new AbortController().signal,'https://api.test',fetcher,'token')).rejects.toMatchObject({code:'NOT_FOUND'});
 expect(fetcher.mock.calls.map(call=>String(call[0]))).toEqual(['https://api.test/health','https://api.test/v1/practice/transcriptions?language=en']);
});

it('does not send practice through an old desktop bridge that only supports paid dictation',async()=>{
 const paid=vi.fn();vi.stubGlobal('window',{sargosh:{transcribeAudio:paid,cancelTranscription:async()=>{}}});
 try{setPracticeSession('practice');await expect(transcriptionTransport(new Blob(['audio'],{type:'audio/webm'}),'en','id',new AbortController().signal)).rejects.toThrow('Restart Sargosh');expect(paid).not.toHaveBeenCalled();}finally{setPracticeSession(null);vi.unstubAllGlobals();}
});

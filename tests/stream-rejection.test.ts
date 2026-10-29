import {expect,it,vi} from 'vitest';
import {Readable,PassThrough} from 'node:stream';
import type {IncomingMessage} from 'node:http';
import {readStreamRejection} from '../src/main/stream-rejection';
it.each([
 [429,'SERVICE_BUSY','SERVICE_BUSY','The service is busy. Please try again shortly.'],
 [429,'BUSY','BUSY','A dictation is already processing for your account. Wait for it to finish, then try again.'],
 [429,'RATE_LIMIT','RATE_LIMIT','Too many requests. Please wait a minute.'],
 [429,'UNKNOWN','SERVICE_BUSY','The service is busy. Please try again shortly.'],
 [503,'API_ERROR','STREAM_CONNECTION','Live dictation could not start. Check the service and your connection.'],
 [404,'UNKNOWN','STREAM_UNSUPPORTED','Live dictation is not available on this backend.'],
 [401,'UNKNOWN','AUTH_REQUIRED','The live session could not be verified. Sign in again and retry.']
])('maps status %s and code %s to safe copy',async(status,code,expected,message)=>{
 const response=Object.assign(Readable.from([Buffer.from(JSON.stringify({code,message:'private upstream details'}))]),{statusCode:status});
 expect(await readStreamRejection(response as unknown as IncomingMessage)).toEqual({code:expected,message});
});
it('bounds oversized rejection bodies',async()=>{
 const response=Object.assign(Readable.from([Buffer.alloc(4097,65)]),{statusCode:429});
 expect((await readStreamRejection(response as unknown as IncomingMessage)).code).toBe('SERVICE_BUSY');expect(response.destroyed).toBe(true);
});
it('bounds stalled rejection responses',async()=>{
 vi.useFakeTimers();const response=Object.assign(new PassThrough(),{statusCode:429});
 try{const result=readStreamRejection(response as unknown as IncomingMessage);await vi.advanceTimersByTimeAsync(2000);expect((await result).code).toBe('SERVICE_BUSY');expect(response.destroyed).toBe(true);}finally{vi.useRealTimers();}
});

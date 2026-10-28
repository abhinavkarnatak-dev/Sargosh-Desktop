import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Duplex } from 'node:stream';
import WebSocket, { WebSocketServer } from 'ws';
import type { FastifyInstance } from 'fastify';
import { installStreaming, type StreamOptions } from '../src/server/streaming';

class Transport extends Duplex {
  response = '';
  _read() {}
  _write(chunk:Buffer,_encoding:string,done:()=>void) { this.response += chunk.toString(); done(); }
}
const tick = () => new Promise<void>(resolve=>setImmediate(resolve));
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();});
function setup(authorize:StreamOptions['authorize']=async()=> 'owner',extra:Partial<StreamOptions>={}) {
  const server=new EventEmitter();const hooks:Record<string,()=>Promise<void>>={};
  installStreaming({server,addHook:(name:string,fn:()=>Promise<void>)=>{hooks[name]=fn;}} as unknown as FastifyInstance,{enabled:true,apiKey:'fixture',authorize,timingSink:()=>{},...extra});
  const attempt=(id:string)=>{
    const socket=new Transport();
    server.emit('upgrade',{method:'GET',url:`/v1/stream?id=${id}&language=en&cleanup=1`,headers:{upgrade:'websocket','sec-websocket-version':'13','sec-websocket-key':'invalid'},socket:{remoteAddress:'127.0.0.1'}},socket,Buffer.alloc(0));
    return socket;
  };
  return {attempt,close:()=>hooks.preClose()};
}

it('releases an authenticated account and capacity when ws rejects the HTTP upgrade without invoking its callback',async()=>{
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});const s=setup();
  try {
    const first=s.attempt('first');await tick();expect(first.response).toContain('400 Bad Request');
    const second=s.attempt('second');await tick();
    // The real ws rejection returns normally. It must not strand the owner as BUSY.
    expect(second.response).toContain('400 Bad Request');
    const third=s.attempt('third');await tick();expect(third.response).toContain('400 Bad Request');
  } finally { await s.close(); }
});

it('releases timed-out authentication and does not claim an account when its late result arrives',async()=>{
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});let authorize!:(owner:string)=>void;
  const auth=vi.fn().mockImplementationOnce(()=>new Promise<string>(resolve=>{authorize=resolve;})).mockResolvedValue('owner');
  const s=setup(auth);
  try {
    const first=s.attempt('first');await vi.advanceTimersByTimeAsync(15000);expect(first.destroyed).toBe(true);
    authorize('owner');await tick();
    const next=s.attempt('next');await tick();expect(next.response).toContain('400 Bad Request');
  } finally { await s.close(); }
});

it('keeps a live account locked until its stream closes, then accepts the next recording',async()=>{
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
  class LiveSocket extends EventEmitter {
    readyState:number=WebSocket.OPEN;
    send=vi.fn();
    close(){if(this.readyState===WebSocket.CLOSED)return;this.readyState=WebSocket.CLOSED;this.emit('close',1000);}
    terminate(){this.close();}
  }
  const live:LiveSocket[]=[];
  vi.spyOn(WebSocketServer.prototype,'handleUpgrade').mockImplementation((_req,_socket,_head,accepted)=>{const ws=new LiveSocket();live.push(ws);accepted(ws as unknown as WebSocket,_req);});
  const cancel=vi.fn();const s=setup(undefined,{openRecognizer:()=>({ready:Promise.resolve(),send:()=>{},finish:async()=>{throw new Error('not expected');},cancel})});
  try {
    s.attempt('first');await tick();expect(live).toHaveLength(1);
    const blocked=s.attempt('blocked');await tick();expect(blocked.response).toContain('429 Rejected');expect(live).toHaveLength(1);
    live[0].close();await tick();expect(cancel).toHaveBeenCalledOnce();
    s.attempt('next');await tick();expect(live).toHaveLength(2);
    live[1].close();await tick();
  } finally {await s.close();}
});

it('releases disconnected pending handshakes and ignores authorization that completes after disconnect',async()=>{
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});const waiting:Array<(owner:string)=>void>=[];
  const authorize=vi.fn(()=>new Promise<string>(resolve=>waiting.push(resolve)));const s=setup(authorize);
  try {
    const first=s.attempt('first'),second=s.attempt('second');first.destroy();second.destroy();await tick();
    const third=s.attempt('third');expect(authorize).toHaveBeenCalledTimes(3);
    waiting.forEach(resolve=>resolve('owner'));await tick();
    expect(third.response).toContain('400 Bad Request');
  } finally { await s.close(); }
});


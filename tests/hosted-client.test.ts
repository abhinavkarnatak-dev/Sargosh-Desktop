import { expect,it,vi } from 'vitest';
import { transcribeViaLocalAPI } from '../src/shared/local-api';
import { apiEndpoint } from '../src/shared/api-endpoint';
const transcript={text:'Hello.',language:'en',model:'nova-3',durationMs:1000,confidence:.9};
it('warms only a health endpoint then sends a bearer token without the development token',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({status:'ok',service:'sargosh-api'}))).mockResolvedValueOnce(new Response(JSON.stringify(transcript)));
 await expect(transcribeViaLocalAPI({requestId:'one',audio:new Uint8Array([1]).buffer,mimeType:'audio/webm',language:'en'},new AbortController().signal,'https://api.example.com',fetcher,'access-fixture')).resolves.toEqual(transcript);
 expect(fetcher.mock.calls[0][0]).toBe('https://api.example.com/health');expect(fetcher.mock.calls[1][0]).toContain('/v1/transcriptions');
 expect(new Headers(fetcher.mock.calls[0][1]!.headers).has('Authorization')).toBe(false);
 const headers=new Headers(fetcher.mock.calls[1][1]!.headers);expect(headers.get('Authorization')).toBe('Bearer access-fixture');expect(headers.has('x-sargosh-token')).toBe(false);
});
it('does not send audio to a Render loading page or retry paid POSTs automatically',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('<html>Starting</html>'));
 await expect(transcribeViaLocalAPI({requestId:'one',audio:new Uint8Array([1]).buffer,mimeType:'audio/webm',language:'en'},new AbortController().signal,'https://api.example.com',fetcher,'access-fixture')).rejects.toMatchObject({code:'CLOUD_STARTING'});expect(fetcher).toHaveBeenCalledOnce();
});
it('accepts only configured HTTPS origins and rejects credentials, paths, or plain remote HTTP',()=>{
 expect(apiEndpoint('https://api.example.com/')).toBe('https://api.example.com');
 for(const value of ['http://api.example.com','https://user:secret@api.example.com','https://api.example.com/path','https://api.example.com/?key=secret'])expect(()=>apiEndpoint(value)).toThrow();
});

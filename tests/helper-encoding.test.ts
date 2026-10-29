import { expect,it } from 'vitest';
import { helperMessage } from '../src/main/helper';
it.each(['Please send the invitation.','Maine invitation bhej diya.','उसे invite भेजने की कोशिश करो।','हिन्दी नमस्ते café 😊 𑀓'])('round-trips %s through a Windows-codepage-independent helper message',text=>{
 const message=helperMessage({id:1,method:'windows.insert-text',params:{text}});
 expect(message).toMatch(/^[\x00-\x7f]+$/);expect(message.endsWith('\n')).toBe(true);
 expect(JSON.parse(Buffer.from(message,'utf8').toString('latin1')).params.text).toBe(text);
});

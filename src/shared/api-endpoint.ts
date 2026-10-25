export function apiEndpoint(value:string):string {
 const url=new URL(value);
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||(url.protocol!=='https:'&&value!=='http://127.0.0.1:4318'))throw new Error('Configure a valid HTTPS API origin.');
 return url.origin;
}
export const hostedEndpoint=(base:string)=>base.startsWith('https://');

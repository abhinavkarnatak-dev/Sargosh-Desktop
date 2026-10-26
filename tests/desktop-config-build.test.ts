import { it,expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync,readFileSync,rmSync } from 'node:fs';import path from 'node:path';import os from 'node:os';
it('writes only public desktop settings and never copies provider or server keys',()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'sargosh-public-config-'));
 try{
  execFileSync(process.execPath,[path.resolve('scripts/build-desktop-config.mjs')],{cwd:directory,env:{...process.env,SARGOSH_API_URL:'https://api.example.com',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture_public_key',DEEPGRAM_API_KEY:'private-deepgram-fixture',GEMINI_API_KEY:'private-gemini-fixture',SUPABASE_SERVER_KEY:'private-server-fixture'},windowsHide:true});
  const value=JSON.parse(readFileSync(path.join(directory,'dist/desktop-config.json'),'utf8'));
  expect(Object.keys(value).sort()).toEqual(['SARGOSH_API_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_URL']);expect(JSON.stringify(value)).not.toContain('private-');
 }finally{if(path.resolve(directory).startsWith(path.join(path.resolve(os.tmpdir()),'sargosh-public-config-')))rmSync(directory,{recursive:true,force:true});}
});

it('rejects private Supabase credentials before writing distributable configuration',()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'sargosh-public-config-'));
 try{
  expect(()=>execFileSync(process.execPath,[path.resolve('scripts/build-desktop-config.mjs')],{cwd:directory,stdio:'pipe',env:{...process.env,SARGOSH_API_URL:'https://api.example.com',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_secret_never_distribute'},windowsHide:true})).toThrow();
 }finally{if(path.resolve(directory).startsWith(path.join(path.resolve(os.tmpdir()),'sargosh-public-config-')))rmSync(directory,{recursive:true,force:true});}
});

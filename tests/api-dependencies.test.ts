import { it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
it('keeps the API dependency graph independent of desktop files and dependencies',()=>{
 const manifest=JSON.parse(readFileSync('deploy/api/package.json','utf8'));
 const lock=JSON.parse(readFileSync('deploy/api/package-lock.json','utf8'));
 expect(lock.lockfileVersion).toBeGreaterThanOrEqual(1);
 expect(lock.packages[''].dependencies).toEqual(manifest.dependencies);
 expect(lock.packages[''].devDependencies).toEqual(manifest.devDependencies);
 for(const [name,entry] of Object.entries(lock.packages) as [string,{link?:boolean;resolved?:string}][]){
  expect(name).not.toMatch(/^\.\./);expect(entry.link).not.toBe(true);expect(entry.resolved??'').not.toMatch(/^(file:|\.\.)/);
 }
 expect(Object.keys(manifest.dependencies).sort()).toEqual(['@supabase/supabase-js','fastify']);
});

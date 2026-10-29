// @vitest-environment happy-dom
import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {UsageNavIcon} from '../src/renderer/UsageNavIcon';
it.each(['low','reached',null] as const)('shows only the appropriate sidebar icon for %s',status=>{
 const host=document.createElement('div');host.innerHTML=renderToStaticMarkup(createElement(UsageNavIcon,{status}));
 expect(host.querySelectorAll('svg')).toHaveLength(status?1:0);expect(host.textContent).toBe('');
 expect(host.querySelector('[role=img]')?.getAttribute('aria-label')??null).toBe(status==='reached'?'Allowance reached':status==='low'?'Allowance running low':null);
 expect(host.querySelector('.usage-nav-alert-'+status)!==null).toBe(status!==null);
});

// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AccountPanel } from '../src/renderer/AccountPanel';
vi.mock('../src/renderer/auth', () => ({ useAuth: () => ({ user: { id: 'fixture-id', email: 'tester@example.com', firstName: 'Test', lastName: '' } }) }));
it('requires an explicit typed confirmation, cancels safely, and prevents duplicate submission while busy', async () => {
  vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let finish!: () => void;
  const remove = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  window.sargosh = { deleteAccount: remove } as unknown as NonNullable<typeof window.sargosh>;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const click = async (element: Element) => { await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
  try {
    await act(async () => root.render(createElement(AccountPanel)));
    const open = () => Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Delete account')!;
    await click(open());
    let dialog = host.querySelector('dialog')!;
    expect(dialog.open).toBe(true); expect(dialog.textContent).toContain('cannot be undone');
    expect(dialog.querySelector<HTMLButtonElement>('.danger')!.disabled).toBe(true);
    await click(dialog.querySelector('.secondary')!);expect(dialog.dataset.closing).toBe('true');await act(async()=>vi.advanceTimersByTime(180)); expect(host.querySelector('dialog')).toBeNull(); expect(remove).not.toHaveBeenCalled();
    await click(open()); dialog = host.querySelector('dialog')!;
    const input = dialog.querySelector('input')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'DELETE'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    const confirm = dialog.querySelector<HTMLButtonElement>('.danger')!;
    expect(confirm.disabled).toBe(false); await click(confirm);
    expect(remove).toHaveBeenCalledExactlyOnceWith('DELETE'); expect(confirm.disabled).toBe(true);
    await act(async () => { finish(); });
  } finally { await act(async () => root.unmount()); host.remove(); delete window.sargosh; vi.useRealTimers();vi.unstubAllGlobals(); }
});

it('shows profile save confirmation in a toast instead of inline help',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();const update=vi.fn().mockResolvedValue(undefined);window.sargosh={updateProfile:update} as unknown as NonNullable<typeof window.sargosh>;
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
 await act(async()=>root.render(createElement(AccountPanel)));await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(update).toHaveBeenCalledExactlyOnceWith('Test','');expect(host.querySelector('.success-toast')?.textContent).toBe('Profile saved.');expect(host.querySelector('p[role=status]')).toBeNull();
 await act(async()=>vi.advanceTimersByTime(2000));expect(host.querySelector('.toast')).toBeNull();
 }finally{await act(async()=>root.unmount());host.remove();delete window.sargosh;vi.useRealTimers();vi.unstubAllGlobals();}
});

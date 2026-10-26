import { expect,it } from 'vitest';
import { shortcutLabel } from '../src/shared/shortcut-label';
it('uses compact key labels while leaving stored shortcuts unchanged',()=>{
 const shortcut='Control+Alt+Win+Shift+Space';
 expect(shortcutLabel(shortcut)).toBe('Ctrl + Alt + Win + Shift + Space');expect(shortcut).toBe('Control+Alt+Win+Shift+Space');
 expect(shortcutLabel('Windows+Function+B')).toBe('Win + Fn + B');
 expect(shortcutLabel('Control+F12')).toBe('Ctrl + F12');
 expect(shortcutLabel('ctrl+alt+k')).toBe('Ctrl + Alt + k');
});

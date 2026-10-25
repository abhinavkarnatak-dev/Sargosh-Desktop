import { expect, it, vi } from 'vitest';
import koffi from 'koffi';
import { enableOverlayInput, IGNORE_MOUSE_ACTIVATE, MOUSE_ACTIVATE, windowsOverlayProperties } from '../src/main/overlay-input';
it.skipIf(process.platform !== 'win32')('rearms the Chromium activation property before every mouse activation without changing focus', () => {
  // An invisible test-owned Win32 window exercises the real API binding.
  const user32 = koffi.load('user32.dll');
  const create = user32.func('uintptr_t __stdcall CreateWindowExW(uint32_t ex, const char16_t *cls, const char16_t *title, uint32_t style, int x, int y, int w, int h, uintptr_t parent, uintptr_t menu, uintptr_t instance, void *param)');
  const destroy = user32.func('int __stdcall DestroyWindow(uintptr_t hwnd)');
  const get = user32.func('uintptr_t __stdcall GetPropW(uintptr_t hwnd, const char16_t *name)');
  const foreground = user32.func('uintptr_t __stdcall GetForegroundWindow()');
  const remove = user32.func('uintptr_t __stdcall RemovePropW(uintptr_t hwnd, const char16_t *name)');
  const handle = BigInt(create(0, 'STATIC', 'Sargosh hidden API test', 0, 0, 0, 1, 1, 0, 0, 0, null));
  expect(handle).not.toBe(0n);
  try {
    const buffer = Buffer.alloc(koffi.sizeof('uintptr_t'));
    if (buffer.length === 8) buffer.writeBigUInt64LE(handle); else buffer.writeUInt32LE(Number(handle));
    let hook!: () => void; let close!: () => void;
    const unhook = vi.fn();
    const window = {
      getNativeWindowHandle: () => buffer,
      hookWindowMessage: vi.fn((message, callback) => { expect(message).toBe(MOUSE_ACTIVATE); hook = callback; }),
      unhookWindowMessage: unhook,
      once: vi.fn((_event, callback) => { close = callback; })
    } as unknown as Parameters<typeof enableOverlayInput>[0];
    const before = foreground();
    enableOverlayInput(window);
    expect(Number(get(handle, IGNORE_MOUSE_ACTIVATE))).toBe(1);
    for (let click = 0; click < 4; click++) {
      // Chromium removes the one-shot property while handling each press.
      remove(handle, IGNORE_MOUSE_ACTIVATE);
      expect(Number(get(handle, IGNORE_MOUSE_ACTIVATE))).toBe(0);
      hook(); expect(Number(get(handle, IGNORE_MOUSE_ACTIVATE))).toBe(1);
    }
    expect(foreground()).toBe(before);
    close(); expect(unhook).toHaveBeenCalledExactlyOnceWith(MOUSE_ACTIVATE);
    expect(Number(get(handle, IGNORE_MOUSE_ACTIVATE))).toBe(0);
  } finally { destroy(handle); }
});
it.skipIf(process.platform !== 'win32')('reports a native setup failure instead of leaving an inert overlay', () => {
  expect(() => windowsOverlayProperties().arm(0n)).toThrow('Could not enable mouse input');
});

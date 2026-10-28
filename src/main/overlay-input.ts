import type { BrowserWindow } from 'electron';
import koffi from 'koffi';

export const MOUSE_ACTIVATE = 0x0021;
export const IGNORE_MOUSE_ACTIVATE = 'Chrome.IgnoreMouseActivate';
export function windowsOverlayProperties() {
  const user32 = koffi.load('user32.dll');
  const setProp = user32.func('int __stdcall SetPropW(uintptr_t hwnd, const char16_t *name, uintptr_t value)');
  const removeProp = user32.func('uintptr_t __stdcall RemovePropW(uintptr_t hwnd, const char16_t *name)');
  return {
    arm(handle: bigint) {
      if (!setProp(handle, IGNORE_MOUSE_ACTIVATE, 1)) throw new Error('Could not enable mouse input for the dictation overlay.');
    },
    clear(handle: bigint) { removeProp(handle, IGNORE_MOUSE_ACTIVATE); }
  };
}
type OverlayProperties = ReturnType<typeof windowsOverlayProperties>;
export function overlayMousePressed() {
  if (process.platform !== 'win32') return () => true;
  const user32 = koffi.load('user32.dll');
  const getKeyState = user32.func('short __stdcall GetAsyncKeyState(int key)');
  return () => (Number(getKeyState(1)) & 0x8000) !== 0;
}
export function enableOverlayInput(window: Pick<BrowserWindow, 'getNativeWindowHandle' | 'hookWindowMessage' | 'unhookWindowMessage' | 'once'>, properties?: OverlayProperties) {
  if (process.platform !== 'win32') return;
  const native = properties ?? windowsOverlayProperties();
  const buffer = window.getNativeWindowHandle();
  const handle = buffer.length === 8 ? buffer.readBigUInt64LE() : BigInt(buffer.readUInt32LE());
  // Chromium consumes this property on each WM_MOUSEACTIVATE and returns
  // MA_NOACTIVATE, preserving the mouse press and the destination's focus.
  // Its default non-focusable path returns MA_NOACTIVATEANDEAT instead.
  // See ui/views/win/hwnd_message_handler.cc: OnMouseActivate.
  native.arm(handle);
  window.hookWindowMessage(MOUSE_ACTIVATE, () => native.arm(handle));
  window.once('close', () => {
    window.unhookWindowMessage(MOUSE_ACTIVATE);
    native.clear(handle);
  });
}

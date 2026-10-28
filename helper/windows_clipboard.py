"""Temporary Unicode paste. Clipboard contents never leave this process.

Fall back only before a paste is attempted. A target requesting the data is
evidence of clipboard consumption, not proof of the final document contents.
"""
import ctypes
from ctypes import wintypes
import time
from uuid import uuid4


class ClipboardUnavailable(Exception):
    """Safe to use keyboard delivery: no paste has been attempted."""

    def __init__(self, reason='clipboard-prepare', format_id=None, windows_error=None):
        super().__init__('Automatic paste preparation unavailable')
        self.reason = reason
        self.format_id = format_id
        self.windows_error = windows_error


def paste_text(text, process_id, validate, send, on_first_input=None, factory=None):
    try:
        clipboard = (factory or WindowsClipboard)()
    except Exception as error:
        raise ClipboardUnavailable('clipboard-window', windows_error=getattr(error, 'winerror', None)) from error
    attempted = False
    try:
        try:
            clipboard.prepare(text, process_id)
        except ClipboardUnavailable:
            raise
        except Exception as error:
            raise ClipboardUnavailable('clipboard-prepare', windows_error=getattr(error, 'winerror', None)) from error
        validate()
        if not clipboard.owns_clipboard():
            raise ClipboardUnavailable('clipboard-changed')
        attempted = True  # Even partial keyboard delivery must never be retried.
        send()
        if on_first_input:
            try:
                on_first_input()
            except Exception:
                pass
        if not clipboard.wait_for_target():
            raise RuntimeError('Paste could not be confirmed. Inspect the destination before retrying.')
    finally:
        # After dispatch, restoring before the target reads would paste OLD data.
        clipboard.close(restore=not attempted or clipboard.consumed)


class WindowsClipboard:
    def __init__(self):
        self.user = ctypes.WinDLL('user32', use_last_error=True)
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        self.gdi = ctypes.WinDLL('gdi32', use_last_error=True)
        self.consumed = False
        self.rendered = False
        self.changed = False
        self.snapshot = []
        self.sequence = None
        self.payload = None
        self.hwnd = None
        self.class_name = 'SargoshClipboard' + uuid4().hex
        callback = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)

        class WindowClass(ctypes.Structure):
            _fields_ = [('style', wintypes.UINT), ('proc', callback), ('class_extra', ctypes.c_int),
                        ('window_extra', ctypes.c_int), ('instance', wintypes.HINSTANCE),
                        ('icon', wintypes.HICON), ('cursor', wintypes.HANDLE), ('background', wintypes.HBRUSH),
                        ('menu', wintypes.LPCWSTR), ('name', wintypes.LPCWSTR)]

        def signature(library, name, args, result):
            function = getattr(library, name)
            function.argtypes, function.restype = args, result

        signature(self.kernel, 'GlobalAlloc', [wintypes.UINT, ctypes.c_size_t], wintypes.HGLOBAL)
        signature(self.kernel, 'GlobalLock', [wintypes.HGLOBAL], ctypes.c_void_p)
        signature(self.kernel, 'GlobalUnlock', [wintypes.HGLOBAL], wintypes.BOOL)
        signature(self.kernel, 'GlobalSize', [wintypes.HGLOBAL], ctypes.c_size_t)
        signature(self.kernel, 'GlobalFree', [wintypes.HGLOBAL], wintypes.HGLOBAL)
        signature(self.kernel, 'GetModuleHandleW', [wintypes.LPCWSTR], wintypes.HMODULE)
        signature(self.user, 'RegisterClassW', [ctypes.POINTER(WindowClass)], wintypes.WORD)
        signature(self.user, 'UnregisterClassW', [wintypes.LPCWSTR, wintypes.HINSTANCE], wintypes.BOOL)
        signature(self.user, 'CreateWindowExW', [wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR,
                  wintypes.DWORD, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                  wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, ctypes.c_void_p], wintypes.HWND)
        signature(self.user, 'DestroyWindow', [wintypes.HWND], wintypes.BOOL)
        signature(self.user, 'DefWindowProcW', [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM], ctypes.c_ssize_t)
        signature(self.user, 'OpenClipboard', [wintypes.HWND], wintypes.BOOL)
        signature(self.user, 'CloseClipboard', [], wintypes.BOOL)
        signature(self.user, 'EmptyClipboard', [], wintypes.BOOL)
        signature(self.user, 'EnumClipboardFormats', [wintypes.UINT], wintypes.UINT)
        signature(self.user, 'GetClipboardData', [wintypes.UINT], wintypes.HANDLE)
        signature(self.user, 'SetClipboardData', [wintypes.UINT, wintypes.HANDLE], wintypes.HANDLE)
        signature(self.user, 'GetClipboardSequenceNumber', [], wintypes.DWORD)
        signature(self.user, 'GetClipboardOwner', [], wintypes.HWND)
        signature(self.user, 'GetOpenClipboardWindow', [], wintypes.HWND)
        signature(self.user, 'GetWindowThreadProcessId', [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)], wintypes.DWORD)
        signature(self.user, 'PeekMessageW', [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT, wintypes.UINT], wintypes.BOOL)
        signature(self.user, 'DispatchMessageW', [ctypes.POINTER(wintypes.MSG)], ctypes.c_ssize_t)
        signature(self.user, 'RegisterClipboardFormatW', [wintypes.LPCWSTR], wintypes.UINT)
        signature(self.user, 'CopyImage', [wintypes.HANDLE, wintypes.UINT, ctypes.c_int, ctypes.c_int, wintypes.UINT], wintypes.HANDLE)
        signature(self.gdi, 'DeleteObject', [wintypes.HANDLE], wintypes.BOOL)
        self.instance = self.kernel.GetModuleHandleW(None)
        self.proc = callback(self._message)
        window_class = WindowClass()
        window_class.proc, window_class.instance, window_class.name = self.proc, self.instance, self.class_name
        if not self.user.RegisterClassW(ctypes.byref(window_class)):
            raise ctypes.WinError(ctypes.get_last_error())
        self.hwnd = self.user.CreateWindowExW(0, self.class_name, '', 0, 0, 0, 0, 0, wintypes.HWND(-3), None, self.instance, None)
        if not self.hwnd:
            error = ctypes.get_last_error()
            self.user.UnregisterClassW(self.class_name, self.instance)
            raise ctypes.WinError(error)

    def _allocate(self, data):
        handle = self.kernel.GlobalAlloc(0x0002, len(data))
        if not handle:
            raise MemoryError('Clipboard allocation failed')
        pointer = self.kernel.GlobalLock(handle)
        if not pointer:
            self.kernel.GlobalFree(handle)
            raise OSError('Clipboard memory unavailable')
        ctypes.memmove(pointer, data, len(data))
        self.kernel.GlobalUnlock(handle)
        return handle

    def _open(self):
        deadline = time.monotonic() + .2
        while not self.user.OpenClipboard(self.hwnd):
            if time.monotonic() >= deadline:
                raise ClipboardUnavailable('clipboard-busy', windows_error=ctypes.get_last_error())
            time.sleep(.01)

    def prepare(self, text, process_id):
        self.process_id = process_id
        self.payload = self._allocate((text.replace('\r\n', '\n').replace('\r', '\n').replace('\n', '\r\n') + '\0').encode('utf-16-le'))
        self._open()
        try:
            format_id, total = 0, 0
            while True:
                ctypes.set_last_error(0)
                format_id = self.user.EnumClipboardFormats(format_id)
                if not format_id:
                    if ctypes.get_last_error():
                        raise OSError('Clipboard format enumeration failed')
                    break
                # Bitmap handles require CopyImage/DeleteObject, not GlobalSize
                # or GlobalFree. Screenshot clips commonly contain this format.
                if format_id == 2:
                    handle = self.user.GetClipboardData(format_id)
                    copy = self.user.CopyImage(handle, 0, 0, 0, 0x2000) if handle else None
                    if not copy:
                        raise ClipboardUnavailable('clipboard-memory', format_id, ctypes.get_last_error())
                    self.snapshot.append((format_id, copy))
                    continue
                # Other non-memory handles remain untouched through fallback.
                if format_id not in (1, 4, 6, 7, 8, 13, 15, 16, 17) and format_id < 0xC000:
                    raise ClipboardUnavailable('clipboard-format', format_id)
                handle = self.user.GetClipboardData(format_id)
                size = self.kernel.GlobalSize(handle) if handle else 0
                total += size
                if not size or total > 16 * 1024 * 1024:
                    raise ClipboardUnavailable('clipboard-memory', format_id, ctypes.get_last_error())
                pointer = self.kernel.GlobalLock(handle)
                if not pointer:
                    raise OSError('Clipboard data unavailable')
                try:
                    data = ctypes.string_at(pointer, size)
                finally:
                    self.kernel.GlobalUnlock(handle)
                self.snapshot.append((format_id, self._allocate(data)))
            if not self.user.EmptyClipboard():
                raise OSError('Clipboard preparation failed')
            self.changed = True
            # Exclude temporary dictation from Windows clipboard history/sync.
            for name in ('CanIncludeInClipboardHistory', 'CanUploadToCloudClipboard'):
                flag = self.user.RegisterClipboardFormatW(name)
                if not flag:
                    raise OSError('Clipboard privacy format unavailable')
                self._publish(flag, self._allocate(b'\0\0\0\0'))
            ctypes.set_last_error(0)
            self.user.SetClipboardData(13, None)  # Render only on request.
            if ctypes.get_last_error():
                raise OSError('Delayed clipboard preparation failed')
        finally:
            # CloseClipboard commits the write and can advance the sequence.
            # Sampling before close mistakes our own write for a user's copy.
            # Owner verification still rejects another process taking ownership
            # between close, sampling, focus validation and actual dispatch.
            self.user.CloseClipboard()
            if self.changed:
                self.sequence = self.user.GetClipboardSequenceNumber()

    def _publish(self, format_id, handle):
        if not self.user.SetClipboardData(format_id, handle):
            self._free(format_id, handle)
            raise OSError('Clipboard write failed')

    def _free(self, format_id, handle):
        if format_id == 2:
            self.gdi.DeleteObject(handle)
        else:
            self.kernel.GlobalFree(handle)

    def _message(self, hwnd, message, wparam, lparam):
        if message == 0x0305 and wparam == 13 and self.payload:  # WM_RENDERFORMAT
            try:
                reader = self.user.GetOpenClipboardWindow()
                pid = wintypes.DWORD()
                self.user.GetWindowThreadProcessId(reader, ctypes.byref(pid))
                self._publish(13, self.payload)
                self.payload = None
                self.rendered = True
                self.sequence = self.user.GetClipboardSequenceNumber()
                self.consumed = pid.value == self.process_id
            except Exception:
                self.payload = None  # _publish frees a failed transfer.
            return 0
        return self.user.DefWindowProcW(hwnd, message, wparam, lparam)

    def owns_clipboard(self):
        return (self.changed and self.user.GetClipboardOwner() == self.hwnd
                and self.sequence == self.user.GetClipboardSequenceNumber())

    def wait_for_target(self):
        message = wintypes.MSG()
        deadline = time.monotonic() + 1.0
        while time.monotonic() < deadline:
            while self.user.PeekMessageW(ctypes.byref(message), self.hwnd, 0, 0, 1):
                self.user.DispatchMessageW(ctypes.byref(message))
            if self.consumed:
                return True
            if self.rendered:
                # Some readers open the clipboard without an HWND, so their
                # process cannot be established. Keep the transcript available
                # rather than risk restoring old data before the target reads.
                return True
            if not self.owns_clipboard():
                return False
            time.sleep(.005)
        return False

    def close(self, restore):
        try:
            if restore and self.owns_clipboard():
                self._open()
                try:
                    if self.owns_clipboard() and self.user.EmptyClipboard():
                        while self.snapshot:
                            format_id, handle = self.snapshot.pop(0)
                            self._publish(format_id, handle)
                finally:
                    self.user.CloseClipboard()
            elif self.owns_clipboard() and self.payload:
                # Unconfirmed/delayed paste: keep the transcript, not old data.
                self._open()
                try:
                    if self.owns_clipboard():
                        handle, self.payload = self.payload, None
                        self._publish(13, handle)
                finally:
                    self.user.CloseClipboard()
        except Exception:
            pass  # Restoration failure cannot cause another insertion attempt.
        finally:
            for format_id, handle in self.snapshot:
                self._free(format_id, handle)
            self.snapshot.clear()
            if self.payload:
                self.kernel.GlobalFree(self.payload)
            self.user.DestroyWindow(self.hwnd)
            self.user.UnregisterClassW(self.class_name, self.instance)

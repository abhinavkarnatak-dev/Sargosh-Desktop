"""Clipboard-free Windows delivery. All UIA calls belong to the worker thread."""
import ctypes
from ctypes import wintypes
import os
import sys
import time
from pathlib import Path
from uuid import uuid4
from destinations import Destination
from windows_keyboard import INPUT_TAG
from text_input import character_events


TEST_TEXT = 'Sargosh input test.'
CHARACTER_INTERVAL_SECONDS = 0.015


class UIAutomation:
    def __init__(self, events, ignored_processes, generation):
        sys.coinit_flags = 0
        import comtypes
        import comtypes.client
        self.comtypes = comtypes
        comtypes.CoInitializeEx(0)  # Dedicated worker uses the multithreaded COM apartment.
        self.types = comtypes.client.GetModule('UIAutomationCore.dll')
        self.uia = comtypes.client.CreateObject(self.types.CUIAutomation, interface=self.types.IUIAutomation)
        self.ignored = set(ignored_processes) | {os.getpid()}
        self.targets = {}
        self.by_runtime = {}
        self.user32 = ctypes.WinDLL('user32', use_last_error=True)
        self.user32.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
        self.user32.GetAncestor.restype = wintypes.HWND
        self.user32.SetForegroundWindow.argtypes = [wintypes.HWND]
        self.user32.SetForegroundWindow.restype = wintypes.BOOL
        self.user32.IsWindow.argtypes = [wintypes.HWND]
        self.user32.IsWindow.restype = wintypes.BOOL
        self.user32.IsIconic.argtypes = [wintypes.HWND]
        self.user32.IsIconic.restype = wintypes.BOOL
        self.user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
        self.user32.GetAsyncKeyState.argtypes = [ctypes.c_int]
        self.user32.GetAsyncKeyState.restype = ctypes.c_short
        self.user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
        self.user32.GetWindowThreadProcessId.restype = wintypes.DWORD
        self.user32.GetKeyboardLayout.argtypes = [wintypes.DWORD]
        self.user32.GetKeyboardLayout.restype = wintypes.HANDLE
        self.user32.VkKeyScanExW.argtypes = [wintypes.WCHAR, wintypes.HANDLE]
        self.user32.VkKeyScanExW.restype = ctypes.c_short
        self.user32.GetKeyState.argtypes = [ctypes.c_int]
        self.user32.GetKeyState.restype = ctypes.c_short
        backend = self

        class FocusHandler(comtypes.COMObject):
            _com_interfaces_ = [backend.types.IUIAutomationFocusChangedEventHandler]

            def HandleFocusChangedEvent(self, sender):
                try:
                    retained = sender.QueryInterface(backend.types.IUIAutomationElement)
                    events.put(('focus', (generation, retained)))
                except Exception:
                    pass
                return 0

        self.handler = FocusHandler()
        self.uia.AddFocusChangedEventHandler(None, self.handler)

    def close(self):
        try:
            self.uia.RemoveFocusChangedEventHandler(self.handler)
        finally:
            self.targets.clear()
            self.by_runtime.clear()
            self.comtypes.CoUninitialize()

    def _application(self, process_id):
        kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel32.OpenProcess(0x1000, False, process_id)
        if not handle:
            return 'Windows application'
        try:
            length = wintypes.DWORD(4096)
            name = ctypes.create_unicode_buffer(length.value)
            if kernel32.QueryFullProcessImageNameW(handle, 0, name, ctypes.byref(length)):
                return Path(name.value).name
            return 'Windows application'
        finally:
            kernel32.CloseHandle(handle)

    def focused(self):
        return self.capture(self.uia.GetFocusedElement())

    def _writable(self, element):
        writable = False
        try:
            pattern = element.GetCurrentPattern(self.types.UIA_ValuePatternId)
            writable = not pattern.QueryInterface(self.types.IUIAutomationValuePattern).CurrentIsReadOnly
        except Exception:
            try:
                pattern = element.GetCurrentPattern(self.types.UIA_TextPatternId).QueryInterface(self.types.IUIAutomationTextPattern)
                read_only = pattern.DocumentRange.GetAttributeValue(self.types.UIA_IsReadOnlyAttributeId)
                writable = type(read_only) is bool and not read_only
            except Exception:
                pass
        return writable

    def capture(self, element):
        if not element:
            return None
        process_id = element.CurrentProcessId
        if process_id in self.ignored:
            return None
        if element.CurrentIsPassword:
            return Destination('protected', 'Password field', process_id, True)
        if not element.CurrentIsEnabled or element.CurrentIsOffscreen:
            return None
        # TextPattern alone also exists on read-only documents. Require an editable control
        # or an explicitly writable ValuePattern. Never read a control's text or value.
        writable = self._writable(element)
        if not writable:
            return None
        runtime = tuple(element.GetRuntimeId())
        token = self.by_runtime.get(runtime)
        if not token:
            token = str(uuid4())
            self.by_runtime[runtime] = token
        hwnd_element = element
        hwnd = 0
        for _ in range(40):
            if not hwnd_element:
                break
            hwnd = hwnd_element.CurrentNativeWindowHandle
            if hwnd:
                break
            hwnd_element = self.uia.ControlViewWalker.GetParentElement(hwnd_element)
        if not hwnd:
            return None
        root = self.user32.GetAncestor(hwnd, 2)
        if not root:
            return None
        self.targets[token] = (element, root, process_id, runtime)
        # Keep only recent references. An active session is pinned explicitly by retain().
        self._prune(token)
        return Destination(token, self._application(process_id), process_id)

    def _prune(self, current):
        protected = getattr(self, 'retained', None)
        if len(self.targets) > 64:
            for token in list(self.targets):
                if token not in (current, protected):
                    self.targets.pop(token, None)
        self.by_runtime = {runtime: token for runtime, token in self.by_runtime.items() if token in self.targets}

    def retain(self, token):
        self.retained = token

    def insert_test(self, destination):
        return self.insert_text(destination, TEST_TEXT)

    def insert_text(self, destination, text, cancelled=None):
        def check_cancelled():
            if cancelled and cancelled.is_set():
                raise ValueError('Insertion cancelled')
        check_cancelled()
        reference = self.targets.get(destination.token)
        if not reference:
            raise ValueError('The remembered input is no longer available')
        element, hwnd, process_id, runtime = reference
        if not self.user32.IsWindow(hwnd) or element.CurrentProcessId != process_id or tuple(element.GetRuntimeId()) != runtime:
            raise ValueError('The remembered input no longer exists')
        if element.CurrentIsPassword or not element.CurrentIsEnabled or element.CurrentIsOffscreen or not self._writable(element):
            raise ValueError('The remembered input is unavailable or protected')
        # Do not release somebody else's held keys or type while their modifiers are held.
        deadline = time.monotonic() + 0.8
        while any(self.user32.GetAsyncKeyState(vk) & 0x8000 for vk in (0x10, 0x11, 0x12, 0x5B, 0x5C)):
            if time.monotonic() >= deadline:
                raise ValueError('Release keyboard modifiers before inserting')
            check_cancelled()
            time.sleep(0.01)
        if self.user32.IsIconic(hwnd):
            self.user32.ShowWindow(hwnd, 9)
        if not self.user32.SetForegroundWindow(hwnd):
            raise ValueError('Windows did not allow the destination to become active')
        element.SetFocus()
        current = self.uia.GetFocusedElement()
        if not self.uia.CompareElements(current, element) or current.CurrentIsPassword:
            raise ValueError('Destination focus could not be confirmed')
        thread_id = self.user32.GetWindowThreadProcessId(hwnd, None)
        layout = self.user32.GetKeyboardLayout(thread_id)
        if not thread_id or not layout:
            raise ValueError('Destination keyboard layout is unavailable')

        def before_character():
            check_cancelled()
            current = self.uia.GetFocusedElement()
            if not self.uia.CompareElements(current, element) or current.CurrentIsPassword:
                raise ValueError('Destination focus changed during delivery')
            if any(self.user32.GetAsyncKeyState(vk) & 0x8000 for vk in (0x10, 0x11, 0x12, 0x5B, 0x5C)):
                raise ValueError('Keyboard modifiers changed during delivery')
            if self.user32.GetKeyboardLayout(thread_id) != layout:
                raise ValueError('Keyboard layout changed during delivery')

        self._send_text(text, before_character=before_character, layout=layout)
        # Input delivery cannot prove the application's final document contents.
        return {'status': 'sent', 'message': 'Text sent to your saved input.'}

    def _send_text(self, text, before_character=None, layout=None):
        class MouseInput(ctypes.Structure):
            _fields_ = [('dx', wintypes.LONG), ('dy', wintypes.LONG), ('mouseData', wintypes.DWORD),
                        ('dwFlags', wintypes.DWORD), ('time', wintypes.DWORD), ('dwExtraInfo', ctypes.c_size_t)]

        class KeyboardInput(ctypes.Structure):
            _fields_ = [('wVk', wintypes.WORD), ('wScan', wintypes.WORD), ('dwFlags', wintypes.DWORD),
                        ('time', wintypes.DWORD), ('dwExtraInfo', ctypes.c_size_t)]

        class HardwareInput(ctypes.Structure):
            _fields_ = [('uMsg', wintypes.DWORD), ('wParamL', wintypes.WORD), ('wParamH', wintypes.WORD)]

        class InputUnion(ctypes.Union):
            _fields_ = [('mi', MouseInput), ('ki', KeyboardInput), ('hi', HardwareInput)]

        class Input(ctypes.Structure):
            _anonymous_ = ('data',)
            _fields_ = [('type', wintypes.DWORD), ('data', InputUnion)]

        self.user32.SendInput.argtypes = [wintypes.UINT, ctypes.POINTER(Input), ctypes.c_int]
        self.user32.SendInput.restype = wintypes.UINT
        # Some editors handle a rapid Unicode burst poorly. Pace whole characters,
        # keeping both UTF-16 surrogate units of a non-BMP character together.
        text = text.replace('\r\n', '\n').replace('\r', '\n')
        for character_index, character in enumerate(text):
            if character_index:
                time.sleep(CHARACTER_INTERVAL_SECONDS)
            if before_character:
                before_character()
            mapping = self.user32.VkKeyScanExW(character, layout) if layout and ord(character) < 0x80 else -1
            caps_lock = bool(self.user32.GetKeyState(0x14) & 1) if layout else False
            events = character_events(character, mapping, caps_lock)
            inputs = (Input * len(events))()
            for index, (key, scan, flags) in enumerate(events):
                inputs[index].type = 1
                inputs[index].ki = KeyboardInput(key, scan, flags, 0, INPUT_TAG)
            sent = self.user32.SendInput(len(inputs), inputs, ctypes.sizeof(Input))
            if sent != len(inputs):
                # Release only keys this partial batch left pressed. Never resend text.
                held = []
                for key, scan, flags in events[:max(0, min(sent, len(events)))]:
                    if key not in (0x10, 0x0d):
                        continue
                    if flags & 0x0002:
                        if key in held:
                            held.remove(key)
                    else:
                        held.append(key)
                for key in reversed(held):
                    release = Input()
                    release.type = 1
                    release.ki = KeyboardInput(key, 0, 0x0002, 0, INPUT_TAG)
                    self.user32.SendInput(1, ctypes.pointer(release), ctypes.sizeof(Input))
                raise RuntimeError('Windows input delivery was incomplete. Inspect the destination before trying another session.')

import ctypes
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch, ANY
from destinations import Destination
from windows_uia import UIAutomation
from windows_keyboard import INPUT_TAG


class Function:
    def __init__(self, fn):
        self.fn = fn
    def __call__(self, *args):
        return self.fn(*args)


class Element:
    CurrentProcessId = 123
    CurrentIsPassword = False
    CurrentIsEnabled = True
    CurrentIsOffscreen = False
    CurrentNativeWindowHandle = 10

    def __init__(self, value_readonly=False, text_readonly=False, has_value=True):
        self.value_readonly = value_readonly
        self.text_readonly = text_readonly
        self.has_value = has_value

    def GetRuntimeId(self):
        return [1, 123, 42]

    def GetCurrentPattern(self, pattern):
        if pattern == 1:
            if not self.has_value:
                raise ValueError('No value pattern')
            return SimpleNamespace(QueryInterface=lambda _: SimpleNamespace(CurrentIsReadOnly=self.value_readonly))
        return SimpleNamespace(QueryInterface=lambda _: SimpleNamespace(DocumentRange=SimpleNamespace(GetAttributeValue=lambda _: self.text_readonly)))

    def SetFocus(self):
        pass


def backend(element=None):
    instance = object.__new__(UIAutomation)
    instance.types = SimpleNamespace(UIA_ValuePatternId=1, UIA_TextPatternId=2,
                                     IUIAutomationValuePattern=None, IUIAutomationTextPattern=None,
                                     UIA_IsReadOnlyAttributeId=40015)
    instance.ignored = set()
    instance.targets = {}
    instance.by_runtime = {}
    instance._application = lambda _: 'notepad.exe'
    instance.uia = SimpleNamespace(GetFocusedElement=lambda: element,
                                   CompareElements=lambda actual, expected: actual is expected)
    instance.user32 = SimpleNamespace(GetAncestor=lambda *_: 10, IsWindow=lambda _: True,
                                      IsIconic=lambda _: False, SetForegroundWindow=lambda _: True,
                                      GetAsyncKeyState=lambda _: 0, GetWindowThreadProcessId=lambda *_: 7,
                                      GetKeyboardLayout=lambda _: 1, GetKeyState=lambda _: 0,
                                      VkKeyScanExW=lambda *_: -1)
    return instance


class UIAutomationTests(unittest.TestCase):
    def test_writable_document_is_supported_without_reading_its_text(self):
        element = Element(has_value=False, text_readonly=False)
        target = backend(element).capture(element)
        self.assertEqual(target.application, 'notepad.exe')

    def test_readonly_document_and_readonly_edit_are_rejected(self):
        self.assertIsNone(backend().capture(Element(has_value=False, text_readonly=True)))
        self.assertIsNone(backend().capture(Element(value_readonly=True)))

    def test_own_application_and_password_fields_are_excluded(self):
        element = Element()
        instance = backend()
        instance.ignored.add(123)
        self.assertIsNone(instance.capture(element))
        instance.ignored.clear()
        element.CurrentIsPassword = True
        self.assertTrue(instance.capture(element).protected)
        self.assertEqual(instance.targets, {})

    def test_real_unicode_text_is_forwarded_without_using_the_clipboard(self):
        element = Element(); instance = backend(element); target = instance.capture(element)
        instance._send_text = Mock(); instance.insert_text(target, 'Hello, नमस्ते 👋')
        self.assertEqual(instance._send_text.call_args.args[0], 'Hello, नमस्ते 👋')

    def test_field_that_becomes_readonly_is_rejected_before_typing(self):
        element = Element(); instance = backend(element); target = instance.capture(element)
        element.value_readonly = True; instance._send_text = Mock()
        with self.assertRaises(ValueError): instance.insert_text(target, 'Hello')
        instance._send_text.assert_not_called()

    def test_cancellation_before_delivery_never_types(self):
        import threading
        element = Element(); instance = backend(element); target = instance.capture(element)
        cancelled = threading.Event(); cancelled.set(); instance._send_text = Mock()
        with self.assertRaises(ValueError): instance.insert_text(target, 'Hello', cancelled)
        instance._send_text.assert_not_called()

    def test_focus_must_match_before_keyboard_delivery(self):
        element = Element()
        instance = backend(Element())
        target = instance.capture(element)
        instance._send_text = Mock()
        with self.assertRaises(ValueError):
            instance.insert_test(target)
        instance._send_text.assert_not_called()

    def test_disappeared_destination_cannot_receive_text(self):
        element = Element()
        instance = backend(element)
        target = instance.capture(element)
        instance.user32.IsWindow = lambda _: False
        instance._send_text = Mock()
        with self.assertRaises(ValueError):
            instance.insert_test(target)
        instance._send_text.assert_not_called()

    def test_matching_destination_receives_only_fixed_test_sentence(self):
        element = Element()
        instance = backend(element)
        target = instance.capture(element)
        instance._send_text = Mock()
        self.assertEqual(instance.insert_test(target)['status'], 'sent')
        instance._send_text.assert_called_once_with('Sargosh input test.', before_character=ANY, layout=1)

    def test_unicode_input_layout_and_own_input_tag(self):
        captured = []
        instance = backend()
        instance.user32.SendInput = Function(lambda count, inputs, size: (captured.extend((inputs[index].ki.wScan, inputs[index].ki.dwFlags, inputs[index].ki.dwExtraInfo, size) for index in range(count)), count)[1])
        instance._send_text('A\u0939\U0001f600')
        self.assertEqual([item[0] for item in captured[::2]], [65, 0x0939, 0xD83D, 0xDE00])
        self.assertTrue(all(item[2] == INPUT_TAG for item in captured))
        self.assertEqual(captured[0][1], 4)
        self.assertEqual(captured[1][1], 6)
        self.assertEqual(captured[0][3], 40 if ctypes.sizeof(ctypes.c_void_p) == 8 else 28)

    @patch('windows_uia.time.sleep')
    def test_sentence_is_sent_as_distinct_paced_characters(self, sleep):
        instance = backend()
        batches = []
        def send(count, inputs, size):
            batches.append([(inputs[index].type, inputs[index].ki.wVk, inputs[index].ki.wScan,
                             inputs[index].ki.dwFlags) for index in range(count)])
            return count
        instance.user32.SendInput = Function(send)
        instance._send_text('Sargosh input test.')
        self.assertEqual([batch[0][2] for batch in batches], list(map(ord, 'Sargosh input test.')))
        self.assertTrue(all(len(batch) == 2 for batch in batches))
        self.assertTrue(all(batch[0][0:2] == (1, 0) and batch[0][3] == 4 and batch[1][3] == 6 for batch in batches))
        self.assertEqual(sleep.call_count, len(batches) - 1)

    @patch('windows_uia.time.sleep')
    def test_delivery_stops_if_focus_changes_between_characters(self, _sleep):
        element = Element()
        instance = backend(element)
        target = instance.capture(element)
        batches = []
        def send(count, inputs, size):
            batches.append(count)
            instance.uia.GetFocusedElement = lambda: Element()
            return count
        instance.user32.SendInput = Function(send)
        with self.assertRaisesRegex(ValueError, 'focus changed'):
            instance.insert_test(target)
        self.assertEqual(batches, [2])

    @patch('windows_uia.time.sleep')
    def test_delivery_stops_if_modifiers_are_pressed_between_characters(self, _sleep):
        element = Element()
        instance = backend(element)
        target = instance.capture(element)
        batches = []
        def send(count, inputs, size):
            batches.append(count)
            instance.user32.GetAsyncKeyState = lambda _: 0x8000
            return count
        instance.user32.SendInput = Function(send)
        with self.assertRaisesRegex(ValueError, 'modifiers changed'):
            instance.insert_test(target)
        self.assertEqual(batches, [2])

    @patch('windows_uia.time.sleep')
    def test_surrogate_pair_is_not_split_across_batches(self, sleep):
        instance = backend()
        batches = []
        instance.user32.SendInput = Function(lambda count, inputs, size: (batches.append(count), count)[1])
        instance._send_text('A\U0001f600B')
        self.assertEqual(batches, [2, 4, 2])
        self.assertEqual(sleep.call_count, 2)

    @patch('windows_uia.time.sleep')
    def test_repeated_sessions_use_layout_keys_in_all_mode_orders(self, _sleep):
        from itertools import product
        from destinations import DestinationSession
        from shortcuts import Gesture
        for modes in product('AB', repeat=3):
            with self.subTest(modes=modes):
                element = Element()
                instance = backend(element)
                target = instance.capture(element)
                def mapping(character, _layout):
                    if character == ' ':
                        return 0x20
                    if character == '.':
                        return 0xbe
                    return ord(character.upper()) | (0x100 if character.isupper() else 0)
                instance.user32.VkKeyScanExW = mapping
                output = []
                shift = False
                def send(count, inputs, size):
                    nonlocal shift
                    for index in range(count):
                        key = inputs[index].ki
                        self.assertEqual(key.wScan, 0)
                        self.assertEqual(key.dwExtraInfo, INPUT_TAG)
                        if key.wVk == 0x10:
                            shift = not bool(key.dwFlags & 2)
                        elif not key.dwFlags & 2:
                            output.append(' ' if key.wVk == 0x20 else '.' if key.wVk == 0xbe else chr(key.wVk) if shift else chr(key.wVk).lower())
                    return count
                instance.user32.SendInput = Function(send)
                state = DestinationSession()
                state.observe(target)
                gesture = Gesture()
                def dispatch(events):
                    for event in events:
                        if event == 'prepare': state.prepare()
                        elif event == 'start-hold': state.start('hold')
                        elif event == 'start-hands-free': state.start('hands-free')
                        elif event == 'finish':
                            self.assertTrue(state.finish())
                            instance.insert_test(state.claim_delivery(state.id))
                        elif event == 'cancel-pending': state.cancel()
                for index, mode in enumerate(modes):
                    now = index * 2.0
                    dispatch(gesture.press(now))
                    if mode == 'A':
                        dispatch(gesture.tick(now + .2))
                        dispatch(gesture.release(now + .5))
                    else:
                        dispatch(gesture.release(now + .03))
                        dispatch(gesture.press(now + .1))
                        dispatch(gesture.release(now + .13))
                        dispatch(gesture.press(now + .7))
                        dispatch(gesture.release(now + .73))
                        dispatch(gesture.press(now + .8))
                        dispatch(gesture.release(now + .83))
                    self.assertEqual(gesture.state, 'idle')
                    self.assertEqual(state.phase, 'finished')
                    self.assertTrue(state.delivery_attempted)
                self.assertEqual(''.join(output), 'Sargosh input test.' * 3)
                self.assertFalse(shift)

    def test_partial_shifted_character_releases_our_shift_without_retrying_text(self):
        instance = backend()
        instance.user32.VkKeyScanExW = lambda *_: 0x153
        calls = []
        def send(count, inputs, size):
            if count == 1:
                packet = inputs.contents.ki
                calls.append((packet.wVk, packet.dwFlags))
            else:
                calls.append(count)
            return 1
        instance.user32.SendInput = Function(send)
        with self.assertRaises(RuntimeError):
            instance._send_text('Sargosh', layout=1)
        self.assertEqual(calls, [4, (0x10, 2)])

    @patch('windows_uia.time.sleep')
    def test_layout_switch_stops_delivery_without_resending_text(self, _sleep):
        element = Element()
        instance = backend(element)
        target = instance.capture(element)
        calls = []
        def send(count, inputs, size):
            calls.append(count)
            instance.user32.GetKeyboardLayout = lambda _: 2
            return count
        instance.user32.SendInput = Function(send)
        with self.assertRaisesRegex(ValueError, 'layout changed'):
            instance.insert_test(target)
        self.assertEqual(calls, [2])

    def test_partial_input_is_reported_as_uncertain(self):
        instance = backend()
        instance.user32.SendInput = Function(lambda *_: 1)
        with self.assertRaises(RuntimeError):
            instance._send_text('Hello')


if __name__ == '__main__':
    unittest.main()

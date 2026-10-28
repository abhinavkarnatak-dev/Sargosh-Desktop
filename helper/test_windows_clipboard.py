import unittest
import ctypes
from unittest.mock import Mock, patch
from windows_clipboard import ClipboardUnavailable, WindowsClipboard, paste_text


class ClipboardDeliveryTests(unittest.TestCase):
    def clipboard(self):
        clipboard = Mock()
        clipboard.consumed = True
        clipboard.owns_clipboard.return_value = True
        clipboard.wait_for_target.return_value = True
        return clipboard

    def run_paste(self, clipboard, send=None, validate=None, first=None):
        paste_text('Hello\nनमस्ते 👋', 123, validate or Mock(), send or Mock(),
                   first, factory=lambda: clipboard)

    def test_unicode_and_lists_paste_once_then_restore(self):
        clipboard = self.clipboard(); send = Mock(); first = Mock()
        self.run_paste(clipboard, send=send, first=first)
        clipboard.prepare.assert_called_once_with('Hello\nनमस्ते 👋', 123)
        send.assert_called_once(); first.assert_called_once()
        clipboard.close.assert_called_once_with(restore=True)

    def test_unavailable_snapshot_allows_fallback_without_sending(self):
        clipboard = self.clipboard(); clipboard.prepare.side_effect = OSError('busy')
        send = Mock()
        with self.assertRaises(ClipboardUnavailable):
            self.run_paste(clipboard, send=send)
        send.assert_not_called(); clipboard.close.assert_called_once_with(restore=True)

    def test_changed_clipboard_before_dispatch_allows_fallback(self):
        clipboard = self.clipboard(); clipboard.owns_clipboard.return_value = False
        send = Mock()
        with self.assertRaises(ClipboardUnavailable):
            self.run_paste(clipboard, send=send)
        send.assert_not_called()

    def test_focus_change_or_cancel_before_paste_sends_nothing(self):
        clipboard = self.clipboard(); send = Mock(); validate = Mock(side_effect=ValueError('cancelled'))
        with self.assertRaises(ValueError):
            self.run_paste(clipboard, send, validate)
        send.assert_not_called(); clipboard.close.assert_called_once_with(restore=True)

    def test_partial_dispatch_does_not_allow_keyboard_fallback(self):
        clipboard = self.clipboard(); clipboard.consumed = False
        with self.assertRaises(RuntimeError):
            self.run_paste(clipboard, send=Mock(side_effect=RuntimeError('partial')))
        clipboard.close.assert_called_once_with(restore=False)

    def test_unknown_reader_keeps_transcript_instead_of_restoring_early(self):
        clipboard = self.clipboard(); clipboard.consumed = False
        self.run_paste(clipboard)
        clipboard.close.assert_called_once_with(restore=False)

    def test_timeout_is_uncertain_and_never_restores_old_data_before_a_late_paste(self):
        clipboard = self.clipboard(); clipboard.consumed = False
        clipboard.wait_for_target.return_value = False
        with self.assertRaises(RuntimeError):
            self.run_paste(clipboard)
        clipboard.close.assert_called_once_with(restore=False)

    def test_diagnostics_failure_does_not_break_paste(self):
        clipboard = self.clipboard()
        self.run_paste(clipboard, first=Mock(side_effect=RuntimeError('logging')))
        clipboard.close.assert_called_once_with(restore=True)


class ClipboardOwnershipTests(unittest.TestCase):
    def clipboard(self):
        clipboard = object.__new__(WindowsClipboard)
        clipboard.user = Mock()
        clipboard.kernel = Mock()
        clipboard.gdi = Mock()
        clipboard.hwnd, clipboard.instance, clipboard.class_name = 10, 20, 'test'
        clipboard.changed, clipboard.sequence = True, 5
        clipboard.user.GetClipboardSequenceNumber.return_value = 5
        clipboard.user.GetClipboardOwner.return_value = 10
        clipboard.snapshot = [(13, 101), (0xC001, 102)]
        clipboard.payload = 103
        clipboard.consumed = clipboard.rendered = False
        clipboard.process_id = 123
        return clipboard

    def test_new_user_copy_is_never_overwritten_during_restore(self):
        clipboard = self.clipboard()
        clipboard.user.GetClipboardSequenceNumber.return_value = 6
        clipboard.close(restore=True)
        clipboard.user.EmptyClipboard.assert_not_called()
        clipboard.user.SetClipboardData.assert_not_called()
        self.assertEqual(clipboard.kernel.GlobalFree.call_count, 3)

    def test_changed_owner_is_preserved_even_if_sequence_number_matches(self):
        clipboard = self.clipboard()
        clipboard.user.GetClipboardOwner.return_value = 99
        clipboard.close(restore=True)
        clipboard.user.EmptyClipboard.assert_not_called()
        clipboard.user.SetClipboardData.assert_not_called()

    def test_previous_formats_are_restored_with_their_original_handles(self):
        clipboard = self.clipboard()
        clipboard.close(restore=True)
        clipboard.user.EmptyClipboard.assert_called_once()
        self.assertEqual([call.args for call in clipboard.user.SetClipboardData.call_args_list], [(13, 101), (0xC001, 102)])
        clipboard.kernel.GlobalFree.assert_called_once_with(103)

    def test_new_copy_between_check_and_open_is_also_preserved(self):
        clipboard = self.clipboard()
        clipboard.user.GetClipboardSequenceNumber.side_effect = [5, 6]
        clipboard.close(restore=True)
        clipboard.user.EmptyClipboard.assert_not_called()

    def test_unconfirmed_paste_keeps_unicode_text_available_for_late_reader(self):
        clipboard = self.clipboard()
        clipboard.close(restore=False)
        clipboard.user.EmptyClipboard.assert_not_called()
        clipboard.user.SetClipboardData.assert_called_once_with(13, 103)
        self.assertEqual(clipboard.kernel.GlobalFree.call_count, 2)

    def test_render_request_from_target_marks_consumption_without_opening_clipboard(self):
        clipboard = self.clipboard()
        def get_pid(_window, pid):
            pid._obj.value = 123
        clipboard.user.GetWindowThreadProcessId.side_effect = get_pid
        clipboard._message(10, 0x0305, 13, 0)
        self.assertTrue(clipboard.consumed)
        self.assertTrue(clipboard.rendered)
        self.assertIsNone(clipboard.payload)
        clipboard.user.OpenClipboard.assert_not_called()

    def test_unknown_reader_does_not_authorize_restoration(self):
        clipboard = self.clipboard()
        clipboard._message(10, 0x0305, 13, 0)
        self.assertFalse(clipboard.consumed)
        self.assertTrue(clipboard.rendered)

    def test_bitmap_is_duplicated_as_a_gdi_handle_instead_of_forcing_keyboard_fallback(self):
        clipboard = self.clipboard()
        clipboard.snapshot = []
        clipboard._allocate = Mock(return_value=103)
        clipboard.user.EnumClipboardFormats.side_effect = [2, 0]
        clipboard.user.GetClipboardData.return_value = 200
        clipboard.user.CopyImage.return_value = 201
        with patch('windows_clipboard.ctypes.get_last_error', return_value=0):
            clipboard.prepare('Hello', 123)
        clipboard.user.CopyImage.assert_called_once_with(200, 0, 0, 0, 0x2000)
        clipboard.kernel.GlobalSize.assert_not_called()
        self.assertEqual(clipboard.snapshot, [(2, 201)])
        clipboard.close(restore=True)
        self.assertIn((2, 201), [call.args for call in clipboard.user.SetClipboardData.call_args_list])
        clipboard.gdi.DeleteObject.assert_not_called()  # Ownership passed to Windows.

    def test_close_commits_clipboard_sequence_before_paste_ownership_check(self):
        clipboard = self.clipboard()
        clipboard.snapshot = []
        clipboard._allocate = Mock(return_value=103)
        clipboard.user.EnumClipboardFormats.side_effect = [0]
        clipboard.user.CloseClipboard.side_effect = lambda: setattr(clipboard.user.GetClipboardSequenceNumber, 'return_value', 6)
        send = Mock()
        def request():
            clipboard.consumed = True
            return True
        clipboard.wait_for_target = request
        with patch('windows_clipboard.ctypes.get_last_error', return_value=0):
            paste_text('Hello', 123, Mock(), send, factory=lambda: clipboard)
        send.assert_called_once()
        clipboard.user.SetClipboardData.assert_any_call(13, None)

    def test_another_copy_after_commit_still_prevents_paste_and_restore(self):
        clipboard = self.clipboard()
        clipboard.snapshot = []
        clipboard._allocate = Mock(return_value=103)
        clipboard.user.EnumClipboardFormats.side_effect = [0]
        clipboard.user.CloseClipboard.side_effect = lambda: setattr(clipboard.user.GetClipboardSequenceNumber, 'return_value', 6)
        def new_copy():
            clipboard.user.GetClipboardOwner.return_value = 99
            clipboard.user.GetClipboardSequenceNumber.return_value = 7
        send = Mock()
        with patch('windows_clipboard.ctypes.get_last_error', return_value=0):
            with self.assertRaises(ClipboardUnavailable):
                paste_text('Hello', 123, new_copy, send, factory=lambda: clipboard)
        send.assert_not_called()
        self.assertEqual(clipboard.user.EmptyClipboard.call_count, 1)  # Initial preparation only.

    def test_bitmap_backup_is_deleted_as_gdi_when_clipboard_changed(self):
        clipboard = self.clipboard()
        clipboard.snapshot = [(2, 201)]
        clipboard.user.GetClipboardOwner.return_value = 99
        clipboard.close(restore=True)
        clipboard.gdi.DeleteObject.assert_called_once_with(201)
        self.assertNotIn((201,), [call.args for call in clipboard.kernel.GlobalFree.call_args_list])

    def test_unsupported_format_is_reported_without_changing_clipboard(self):
        clipboard = self.clipboard()
        clipboard.snapshot = []
        clipboard._allocate = Mock(return_value=103)
        clipboard.user.EnumClipboardFormats.side_effect = [14]
        with self.assertRaises(ClipboardUnavailable) as caught:
            clipboard.prepare('Hello', 123)
        self.assertEqual(caught.exception.reason, 'clipboard-format')
        self.assertEqual(caught.exception.format_id, 14)
        clipboard.user.EmptyClipboard.assert_not_called()

    def test_real_native_memory_round_trip_without_changing_clipboard(self):
        # Exercise actual pointer signatures and memory ownership, while never
        # opening or replacing the interactive user's clipboard.
        import sys
        if sys.platform != 'win32':
            self.skipTest('Windows API check')
        clipboard = WindowsClipboard()
        try:
            data = 'नमस्ते 👋\r\n- A\r\n- B\0'.encode('utf-16-le')
            handle = clipboard._allocate(data)
            try:
                pointer = clipboard.kernel.GlobalLock(handle)
                try:
                    self.assertEqual(ctypes.string_at(pointer, len(data)), data)
                finally:
                    clipboard.kernel.GlobalUnlock(handle)
            finally:
                clipboard.kernel.GlobalFree(handle)
        finally:
            clipboard.close(False)

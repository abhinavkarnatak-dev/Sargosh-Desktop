import queue
import threading
import unittest
from unittest.mock import Mock, patch
from native_control import WindowsService
from destinations import Destination
from windows_keyboard import KeyboardHook

class DeliveryTests(unittest.TestCase):
    def service(self):
        service = WindowsService(Mock())
        service.state['purpose'] = 'recording'
        service.uia = Mock()
        service.keyboard = Mock()
        service.session.observe(Destination('target', 'notepad.exe', 123))
        service.session.prepare(); service.session.start('hold'); service.session.finish()
        service.uia.insert_text.return_value = {'status': 'sent', 'message': 'Text sent.'}
        self.addCleanup(service.close)
        return service

    def params(self, service, text='नमस्ते 👋'):
        return {'sessionId': service.session.id, 'targetId': 'target', 'text': text}

    def test_first_input_event_contains_only_the_current_session_id(self):
        service = self.service()
        def send(_destination, _text, _cancelled, on_first_input=None):
            on_first_input()
            return {'status': 'sent', 'message': 'Sent.'}
        service.uia.insert_text.side_effect = send
        service._command('insert-text', self.params(service))
        service.emit.assert_any_call('windows.delivery-first-input', {'sessionId': service.session.id})

    def test_real_text_is_delivered_once_and_claimed_before_sending(self):
        service = self.service()
        def send(destination, text, cancelled, on_first_input=None):
            self.assertTrue(service.session.delivery_attempted)
            self.assertEqual(text, 'नमस्ते 👋')
            return {'status': 'sent', 'message': 'Sent.'}
        service.uia.insert_text.side_effect = send
        with patch('native_control.sys.platform', 'win32'):
            self.assertEqual(service.call('insert-text', self.params(service))['status'], 'sent')
            self.assertEqual(service.call('insert-text', self.params(service))['status'], 'unavailable')
        service.uia.insert_text.assert_called_once()

    def test_wrong_session_target_cancelled_and_input_test_are_rejected(self):
        for field, value in [('sessionId', 'old'), ('targetId', 'other')]:
            service = self.service(); params = self.params(service); params[field] = value
            self.assertEqual(service._command('insert-text', params)['status'], 'unavailable')
            service.uia.insert_text.assert_not_called()
        service = self.service(); service.session.cancel()
        self.assertEqual(service._command('insert-text', self.params(service))['status'], 'unavailable')
        service = self.service(); service.state['purpose'] = 'input-test'
        self.assertEqual(service._command('insert-text', self.params(service))['status'], 'unavailable')

    def test_uncertain_delivery_cannot_be_repeated(self):
        service = self.service(); service.uia.insert_text.side_effect = RuntimeError('Partial insertion')
        self.assertEqual(service._command('insert-text', self.params(service))['status'], 'unconfirmed')
        self.assertEqual(service._command('insert-text', self.params(service))['status'], 'unavailable')
        service.uia.insert_text.assert_called_once()

    def test_failure_diagnostics_are_specific_and_do_not_expose_arbitrary_errors(self):
        for message, code in [
            ('Destination focus changed during delivery', 'focus-changed'),
            ('Paste could not be confirmed. Inspect the destination before retrying.', 'paste-unconfirmed'),
            ('private editor contents', 'native-error'),
        ]:
            service = self.service()
            service.uia.insert_text.side_effect = RuntimeError(message)
            result = service._command('insert-text', self.params(service))
            self.assertEqual(result['errorCode'], code)
            self.assertNotIn('private editor contents', str(result))

    def test_cancellation_reaches_insertion_without_waiting_for_the_worker_queue(self):
        service = self.service(); entered = threading.Event()
        def send(_destination, _text, cancelled, on_first_input=None):
            entered.set()
            if not cancelled.wait(2): raise AssertionError('Cancellation did not reach delivery')
            raise ValueError('Cancelled')
        service.uia.insert_text.side_effect = send; results = []
        with patch('native_control.sys.platform', 'win32'):
            worker = threading.Thread(target=lambda: results.append(service.call('insert-text', self.params(service))))
            worker.start(); self.assertTrue(entered.wait(2)); self.assertTrue(service.input_busy.is_set())
            service.call('cancel-delivery', {'sessionId': 'other'}); self.assertFalse(service.delivery_cancel.is_set())
            service.call('cancel-delivery', {'sessionId': service.session.id}); worker.join(2); self.assertFalse(worker.is_alive())
        self.assertEqual(results[0]['status'], 'unconfirmed'); self.assertFalse(service.input_busy.is_set())

    def test_processing_shortcuts_are_discarded_instead_of_queued(self):
        events = queue.Queue(); blocked = threading.Event(); blocked.set()
        keyboard = KeyboardHook('Control+Alt+Space', events, 1, blocked)
        keyboard._emit(['prepare', 'start-hold']); self.assertTrue(events.empty())
        blocked.clear(); keyboard._emit(['prepare']); self.assertEqual(events.get_nowait(), ('gesture', (1, 'prepare')))

    def test_processing_lock_remains_until_both_cloud_and_delivery_finish(self):
        service = self.service(); service.call('set-busy', {'busy': True})
        service.delivery_busy.set(); service.call('set-busy', {'busy': False}); self.assertTrue(service.input_busy.is_set())
        service.delivery_busy.clear(); service.call('set-busy', {'busy': False}); self.assertFalse(service.input_busy.is_set())

    def test_cancellation_before_delivery_registration_is_not_lost(self):
        service = self.service()
        service.call('cancel-delivery', {'sessionId': service.session.id})
        with patch('native_control.sys.platform', 'win32'):
            self.assertEqual(service.call('insert-text', self.params(service))['status'], 'unavailable')
        service.uia.insert_text.assert_not_called()

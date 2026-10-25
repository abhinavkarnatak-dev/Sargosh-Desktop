import unittest
from destinations import Destination, DestinationSession


A = Destination('a', 'notepad.exe', 123)
B = Destination('b', 'browser.exe', 456)


class DestinationTests(unittest.TestCase):
    def test_latest_editable_target_wins_while_recording(self):
        state = DestinationSession()
        state.observe(A)
        state.prepare()
        state.start('hold')
        state.observe(B)
        self.assertEqual(state.target, B)

    def test_noneditable_focus_does_not_clear_destination(self):
        state = DestinationSession()
        state.observe(A)
        state.prepare()
        state.observe(None)
        self.assertEqual(state.target, A)

    def test_target_freezes_when_finished(self):
        state = DestinationSession()
        state.observe(A)
        state.prepare()
        state.start('hands-free')
        state.finish()
        state.observe(B)
        self.assertEqual(state.target, A)
        self.assertEqual(state.last, B)

    def test_password_focus_clears_active_target(self):
        state = DestinationSession()
        state.observe(A)
        state.prepare()
        state.start('hold')
        state.observe(Destination('password', 'browser.exe', 456, True))
        self.assertIsNone(state.target)
        state.finish()
        with self.assertRaises(ValueError):
            state.claim_delivery(state.id)

    def test_cancel_and_late_delivery_are_rejected(self):
        state = DestinationSession()
        state.observe(A)
        state.prepare()
        state.start('hold')
        previous = state.id
        state.finish()
        state.cancel()
        with self.assertRaises(ValueError):
            state.claim_delivery(previous)
        state.prepare()
        state.start('hold')
        state.finish()
        with self.assertRaises(ValueError):
            state.claim_delivery(previous)

    def test_uncertain_delivery_cannot_be_repeated(self):
        state = DestinationSession()
        state.observe(A)
        state.prepare()
        state.start('hold')
        state.finish()
        self.assertEqual(state.claim_delivery(state.id), A)
        with self.assertRaises(ValueError):
            state.claim_delivery(state.id)

    def test_pending_session_cannot_deliver(self):
        state = DestinationSession()
        state.observe(A)
        state.prepare()
        with self.assertRaises(ValueError):
            state.claim_delivery(state.id)

    def test_public_target_contains_no_document_contents(self):
        state = DestinationSession()
        state.observe(A)
        state.prepare()
        self.assertEqual(state.snapshot()['target'], {'id': 'a', 'application': 'notepad.exe'})


if __name__ == '__main__':
    unittest.main()

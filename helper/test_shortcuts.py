import unittest
from shortcuts import Gesture, parse_shortcut


class GestureTests(unittest.TestCase):
    def test_hold_finishes_on_release(self):
        gesture = Gesture()
        self.assertEqual(gesture.press(0), ['prepare'])
        self.assertEqual(gesture.tick(.2), ['start-hold'])
        self.assertEqual(gesture.release(.9), ['finish'])
        self.assertEqual(gesture.tick(2), [])

    def test_two_double_taps_start_and_finish_hands_free(self):
        gesture = Gesture()
        self.assertEqual(gesture.press(0), ['prepare'])
        self.assertEqual(gesture.release(.05), [])
        self.assertEqual(gesture.press(.15), ['start-hands-free'])
        self.assertEqual(gesture.release(.20), [])
        self.assertEqual(gesture.press(1), [])
        self.assertEqual(gesture.release(1.05), [])
        self.assertEqual(gesture.press(1.15), ['finish'])
        self.assertEqual(gesture.release(1.20), [])
        self.assertEqual(gesture.state, 'idle')

    def test_single_short_tap_does_not_submit_a_recording(self):
        gesture = Gesture()
        gesture.press(0)
        gesture.release(.05)
        self.assertEqual(gesture.tick(.4), ['cancel-pending'])
        self.assertEqual(gesture.tick(.6), [])

    def test_hold_threshold_is_applied_even_if_no_timer_arrived_before_release(self):
        gesture = Gesture()
        gesture.press(0)
        self.assertEqual(gesture.release(.4), ['start-hold', 'finish'])

    def test_repeated_keydown_does_not_start_another_session(self):
        gesture = Gesture()
        gesture.press(0)
        gesture.press(.03)
        gesture.press(.06)
        self.assertEqual(gesture.tick(.2), ['start-hold'])
        self.assertEqual(gesture.release(.3), ['finish'])

    def test_single_tap_in_hands_free_keeps_listening(self):
        gesture = Gesture(state='hands-free')
        gesture.press(0)
        gesture.release(.05)
        self.assertEqual(gesture.tick(.5), [])
        self.assertEqual(gesture.state, 'hands-free')

    def test_starting_double_tap_release_is_not_first_tap_of_finish(self):
        gesture = Gesture()
        gesture.press(0)
        gesture.release(.05)
        gesture.press(.1)
        gesture.release(.15)
        self.assertEqual(gesture.press(.2), [])
        self.assertEqual(gesture.state, 'hands-free')

    def test_late_second_tap_starts_a_new_attempt(self):
        gesture = Gesture()
        gesture.press(0)
        gesture.release(.05)
        self.assertEqual(gesture.press(.6), ['cancel-pending', 'prepare'])

    def test_reset_discards_old_taps_and_pending_holds(self):
        gesture = Gesture()
        gesture.press(0)
        gesture.reset()
        self.assertEqual(gesture.release(.4), [])
        self.assertEqual(gesture.tick(.9), [])

    def test_shortcut_validation(self):
        self.assertEqual(parse_shortcut('Control+Alt+Space'), ({'Control', 'Alt'}, 32))
        self.assertEqual(parse_shortcut('Control+Shift+D'), ({'Control', 'Shift'}, 68))
        for value in ('Space', 'Shift+A', 'Control+Control+A', 'Alt+F4', 'Win+L', 'Control+Unknown'):
            with self.subTest(shortcut=value), self.assertRaises(ValueError):
                parse_shortcut(value)


if __name__ == '__main__':
    unittest.main()

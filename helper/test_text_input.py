import unittest
from text_input import character_events


class CharacterEventsTests(unittest.TestCase):
    def test_layout_mapping_uses_the_returned_key_not_an_english_layout_assumption(self):
        self.assertEqual(character_events('z', 0x59), [(0x59, 0, 0), (0x59, 0, 2)])

    def test_shift_is_balanced_within_each_character(self):
        self.assertEqual(character_events('S', 0x153), [(0x10, 0, 0), (0x53, 0, 0), (0x53, 0, 2), (0x10, 0, 2)])

    def test_caps_lock_inverts_shift_for_ascii_letters_only(self):
        self.assertEqual(character_events('S', 0x153, True), [(0x53, 0, 0), (0x53, 0, 2)])
        self.assertEqual(character_events('s', 0x53, True)[0], (0x10, 0, 0))
        self.assertEqual(character_events('.', 0xbe, True), [(0xbe, 0, 0), (0xbe, 0, 2)])

    def test_ctrl_alt_and_invalid_mappings_use_unicode_instead_of_commands(self):
        for mapping in (-1, 0xffff, 0x641, 0x241, 0x841):
            with self.subTest(mapping=mapping):
                self.assertEqual(character_events('a', mapping), [(0, 97, 4), (0, 97, 6)])

    def test_non_ascii_and_supplementary_characters_remain_unicode(self):
        self.assertEqual(character_events('\u0939'), [(0, 0x939, 4), (0, 0x939, 6)])
        self.assertEqual(character_events('\U0001f600'), [(0, 0xd83d, 4), (0, 0xd83d, 6), (0, 0xde00, 4), (0, 0xde00, 6)])

    def test_one_character_required(self):
        for value in ('', 'ab'):
            with self.assertRaises(ValueError):
                character_events(value)

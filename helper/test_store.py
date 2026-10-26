import tempfile
import unittest
from pathlib import Path
from main import Store


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / 'account-a' / 'history.sqlite3'
        self.store = Store(self.path)

    def tearDown(self):
        self.store.db.close()
        self.directory.cleanup()

    def test_accounts_keep_history_and_preferences_separate_and_preserve_legacy_owner(self):
        first = '11111111-1111-4111-8111-111111111111'
        second = '22222222-2222-4222-8222-222222222222'
        self.store.add(self.entry(), '2026-10-25')
        self.store.preferences({'shortcut': 'Control+Alt+K'})
        original = self.store.select_account(first)
        self.assertEqual(len(self.store.snapshot()['history']), 1)
        self.store.select_account(None)
        self.assertEqual(self.store.snapshot()['history'], [])
        other = self.store.select_account(second)
        self.assertNotEqual(original, other)
        self.assertEqual(self.store.snapshot()['history'], [])
        self.assertEqual(self.store.preferences()['shortcut'], 'Control+Alt+Space')
        self.store.select_account(first)
        self.assertEqual(len(self.store.snapshot()['history']), 1)
        self.assertEqual(self.store.preferences()['shortcut'], 'Control+Alt+K')
        self.assertEqual(self.store.snapshot()['totalWords'], 2)

    def test_account_paths_cannot_escape_local_storage(self):
        for invalid in ['../other', '', 'a/b', 12, 'C:/Users/other']:
            with self.assertRaises(ValueError):
                self.store.select_account(invalid)

    def test_delete_account_removes_only_its_database_and_recordings_and_keeps_legacy_owner(self):
        first = '11111111-1111-4111-8111-111111111111'
        second = '22222222-2222-4222-8222-222222222222'
        for target in (first, second):
            directory = Path(self.store.select_account(target)['directory'])
            self.store.add(self.entry(), '2026-10-25')
            self.store.preferences({'theme': 'dark'})
            (directory / 'recordings').mkdir()
            (directory / 'recordings' / ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.audio')).write_bytes(b'audio')
        self.store.delete_account(first)
        self.assertFalse(self.path.exists())
        self.assertTrue((self.store.base / 'legacy-owner.json').exists())
        self.assertFalse((self.store.base / 'recordings').exists())
        self.store.select_account(second)
        self.assertEqual(len(self.store.snapshot()['history']), 1)
        self.assertEqual(self.store.preferences()['theme'], 'dark')
        self.store.delete_account(second)
        self.assertFalse((self.store.base / 'accounts' / second).exists())
        self.assertEqual(self.store.snapshot()['history'], [])
        self.store.delete_account(second)  # Interrupted cleanup can be retried.

    def test_delete_account_rejects_paths_and_never_recursively_removes_shared_files(self):
        user = '11111111-1111-4111-8111-111111111111'
        self.store.select_account(user)
        other_file = self.store.base / 'keep.txt'
        other_file.write_text('keep')
        for invalid in ('../escape', None, '', 'signed-out'):
            with self.assertRaises(ValueError):
                self.store.delete_account(invalid)
        self.store.delete_account(user)
        self.assertEqual(other_file.read_text(), 'keep')

    def entry(self, status='completed'):
        return {'id': 'recording-a', 'createdAt': '2026-10-25T12:00:00Z', 'text': 'Hello world', 'words': 2, 'durationMs': 2000, 'status': status}

    def test_old_database_is_migrated_without_losing_history_or_preferences(self):
        import sqlite3
        legacy_path = Path(self.directory.name) / 'legacy.sqlite3'
        database = sqlite3.connect(legacy_path)
        database.executescript('CREATE TABLE preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE history (id TEXT PRIMARY KEY, createdAt TEXT NOT NULL, text TEXT NOT NULL, words INTEGER NOT NULL, durationMs INTEGER NOT NULL, status TEXT NOT NULL, error TEXT); CREATE TABLE metrics (id TEXT PRIMARY KEY, day TEXT NOT NULL, words INTEGER NOT NULL, durationMs INTEGER NOT NULL);')
        database.execute('INSERT INTO preferences VALUES (?, ?)', ('theme', '"dark"'))
        database.execute('INSERT INTO history VALUES (?, ?, ?, ?, ?, ?, ?)', ('old', '2026-10-25T12:00:00Z', 'Old words', 2, 1000, 'completed', None))
        database.commit(); database.close()
        migrated = Store(legacy_path)
        try:
            state = migrated.snapshot()
            self.assertEqual(state['preferences']['theme'], 'dark')
            self.assertEqual(state['history'][0]['text'], 'Old words')
            self.assertEqual(state['history'][0]['audioBytes'], 0)
        finally:
            migrated.db.close()

    def test_late_history_update_does_not_recreate_a_deleted_record(self):
        self.store.add(self.entry(), '2026-10-25')
        self.store.handle('delete', {'id': 'recording-a'})
        result = self.store.handle('history.update', {'entry': {**self.entry(), 'originalText': 'Raw', 'language': 'en', 'cleanupEnabled': True}, 'day': '2026-10-25'})
        self.assertIsNone(result)
        self.assertEqual(self.store.snapshot()['history'], [])
        self.assertEqual(self.store.snapshot()['totalWords'], 2)

    def test_preferences_survive_restart(self):
        self.store.preferences({'theme': 'dark', 'collapsed': True, 'shortcut': 'Control+Alt+K'})
        self.store.db.close()
        self.store = Store(self.path)
        self.assertEqual(self.store.preferences()['theme'], 'dark')
        self.assertTrue(self.store.preferences()['collapsed'])
        self.assertEqual(self.store.preferences()['shortcut'], 'Control+Alt+K')

    def test_retries_do_not_duplicate_statistics(self):
        self.store.add(self.entry(), '2026-10-25')
        self.store.add({**self.entry(), 'text': 'Hello new world', 'words': 3}, '2026-10-25')
        state = self.store.snapshot()
        self.assertEqual(state['recordingCount'], 1)
        self.assertEqual(state['totalWords'], 2)
        self.assertEqual(state['history'][0]['text'], 'Hello new world')

    def test_delete_preserves_accumulated_statistics(self):
        self.store.add(self.entry(), '2026-10-25')
        self.store.handle('delete', {'id': 'recording-a'})
        state = self.store.snapshot()
        self.assertEqual(state['history'], [])
        self.assertEqual(state['totalWords'], 2)

    def test_failed_attempt_does_not_count_until_successful(self):
        self.store.add(self.entry('failed'), '2026-10-25')
        self.assertEqual(self.store.snapshot()['recordingCount'], 0)
        self.store.add(self.entry(), '2026-10-25')
        self.assertEqual(self.store.snapshot()['recordingCount'], 1)

    def test_account_directories_are_isolated(self):
        self.store.add(self.entry(), '2026-10-25')
        other = Store(Path(self.directory.name) / 'account-b' / 'history.sqlite3')
        try:
            self.assertEqual(other.snapshot()['history'], [])
            self.assertEqual(other.snapshot()['totalWords'], 0)
        finally:
            other.db.close()

    def test_invalid_preferences_are_rejected_without_changes(self):
        for invalid in ({'theme': 'neon'}, {'collapsed': 'yes'}, {'unexpected': True}):
            with self.assertRaises(ValueError):
                self.store.preferences(invalid)
        self.assertEqual(self.store.preferences()['theme'], 'system')

    def test_arbitrary_helper_commands_are_rejected(self):
        with self.assertRaises(ValueError):
            self.store.handle('run-shell-command', {})


if __name__ == '__main__':
    unittest.main()

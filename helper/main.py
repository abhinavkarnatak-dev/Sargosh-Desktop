"""Local-only storage and process bridge. Never communicates with cloud services."""
import argparse
import json
import sqlite3
import sys
import threading
import re
from native_control import WindowsService
from pathlib import Path


class Store:
    def __init__(self, path):
        self.base = Path(path).parent
        self.path = Path(path)
        self.open_database(path)

    def open_database(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS history (
            id TEXT PRIMARY KEY, createdAt TEXT NOT NULL, text TEXT NOT NULL,
            words INTEGER NOT NULL CHECK(words >= 0), durationMs INTEGER NOT NULL CHECK(durationMs >= 0),
            status TEXT NOT NULL, error TEXT);
        CREATE TABLE IF NOT EXISTS metrics (
            id TEXT PRIMARY KEY, day TEXT NOT NULL, words INTEGER NOT NULL, durationMs INTEGER NOT NULL);
        """)
        columns = {row['name'] for row in self.db.execute('PRAGMA table_info(history)')}
        for name, definition in {'originalText': "TEXT NOT NULL DEFAULT ''", 'language': "TEXT NOT NULL DEFAULT 'en'", 'cleanupEnabled': 'INTEGER NOT NULL DEFAULT 1', 'audioMimeType': "TEXT NOT NULL DEFAULT ''", 'audioBytes': 'INTEGER NOT NULL DEFAULT 0'}.items():
            if name not in columns:
                self.db.execute(f'ALTER TABLE history ADD COLUMN {name} {definition}')
        self.db.commit()

    def select_account(self, user_id):
        if user_id is not None and (not isinstance(user_id, str) or not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', user_id)):
            raise ValueError('Invalid account')
        owner_file = self.base / 'legacy-owner.json'
        owner = json.loads(owner_file.read_text(encoding='utf-8')) if owner_file.exists() else None
        if owner is not None and (not isinstance(owner, str) or not re.fullmatch(r'[a-f0-9-]{36}', owner)):
            raise ValueError('Invalid local account owner')
        claim = user_id is not None and owner is None
        directory = self.base if user_id is not None and (owner == user_id or claim) else self.base / ('accounts/' + user_id if user_id else 'signed-out')
        next_path = directory / 'history.sqlite3'
        previous = self.path
        if next_path != previous:
            self.db.close()
            try:
                self.open_database(next_path)
                self.path = next_path
            except Exception:
                self.open_database(previous)
                raise
        if claim:
            with owner_file.open('x', encoding='utf-8') as file:
                json.dump(user_id, file)
        return {'directory': str(directory.resolve())}

    def delete_account(self, user_id):
        if not isinstance(user_id, str) or not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', user_id):
            raise ValueError('Invalid account')
        owner_file = self.base / 'legacy-owner.json'
        owner = json.loads(owner_file.read_text(encoding='utf-8')) if owner_file.exists() else None
        directory = self.base if owner == user_id else self.base / 'accounts' / user_id
        # Never recursively delete the shared root or follow redirected account paths.
        for candidate in (self.base, self.base / 'accounts', directory, directory / 'recordings'):
            if candidate.is_symlink() or (hasattr(candidate, 'is_junction') and candidate.is_junction()):
                raise ValueError('Local account path is redirected')
        if not directory.resolve().is_relative_to(self.base.resolve()):
            raise ValueError('Invalid local account path')
        if self.path == directory / 'history.sqlite3':
            self.select_account(None)
        recordings = directory / 'recordings'
        if recordings.exists():
            for file in recordings.iterdir():
                if re.fullmatch(r'[a-f0-9-]{36}\.(audio|tmp|deleted)', file.name) and not file.is_dir():
                    file.unlink()
            recordings.rmdir()
        for suffix in ('', '-wal', '-shm'):
            (directory / ('history.sqlite3' + suffix)).unlink(missing_ok=True)
        if directory != self.base and directory.exists():
            directory.rmdir()
        # Retain the ownership marker so a later account cannot claim the legacy root.
        return True

    def preferences(self, update=None):
        if update is not None:
            allowed = {'theme', 'microphoneId', 'collapsed', 'shortcut'}
            if not isinstance(update, dict) or set(update) - allowed:
                raise ValueError('Invalid preferences')
            if 'theme' in update and update['theme'] not in ('system', 'light', 'dark'):
                raise ValueError('Invalid theme')
            if 'collapsed' in update and not isinstance(update['collapsed'], bool):
                raise ValueError('Invalid sidebar preference')
            if 'microphoneId' in update and (not isinstance(update['microphoneId'], str) or len(update['microphoneId']) > 512):
                raise ValueError('Invalid microphone')
            if 'shortcut' in update:
                from shortcuts import parse_shortcut
                parse_shortcut(update['shortcut'])
            with self.db:
                self.db.executemany('INSERT OR REPLACE INTO preferences VALUES (?, ?)', [(key, json.dumps(value)) for key, value in update.items()])
        result = {'theme': 'system', 'microphoneId': 'default', 'collapsed': False, 'shortcut': 'Control+Alt+Space'}
        result.update({row['key']: json.loads(row['value']) for row in self.db.execute('SELECT * FROM preferences')})
        return result

    def snapshot(self):
        totals = self.db.execute('SELECT COALESCE(SUM(words), 0) words, COALESCE(SUM(durationMs), 0) duration, COUNT(*) count FROM metrics').fetchone()
        return {
            'preferences': self.preferences(),
            'history': [self.history_row(row) for row in self.db.execute('SELECT * FROM history ORDER BY createdAt DESC, id DESC LIMIT 50')],
            'activity': [dict(row) for row in self.db.execute('SELECT day date, SUM(words) words FROM metrics GROUP BY day ORDER BY day')],
            'totalWords': totals['words'], 'recordingCount': totals['count'], 'totalDurationMs': totals['duration']
        }

    def add(self, entry, day):
        # Retries update history, but cannot count another recording or alter earned metrics.
        with self.db:
            self.db.execute('INSERT OR REPLACE INTO history (id, createdAt, text, words, durationMs, status, error) VALUES (:id, :createdAt, :text, :words, :durationMs, :status, :error)', {**entry, 'error': entry.get('error')})
            if entry['status'] == 'completed':
                self.db.execute('INSERT OR IGNORE INTO metrics VALUES (?, ?, ?, ?)', (entry['id'], day, entry['words'], entry['durationMs']))

    def history_get(self, recording_id):
        row = self.db.execute('SELECT * FROM history WHERE id = ?', (recording_id,)).fetchone()
        return self.history_row(row) if row else None

    def history_row(self, row):
        result = dict(row)
        result['cleanupEnabled'] = bool(result['cleanupEnabled'])
        return result

    def history_page(self, cursor=None):
        if cursor:
            rows = self.db.execute('SELECT * FROM history WHERE createdAt < ? OR (createdAt = ? AND id < ?) ORDER BY createdAt DESC, id DESC LIMIT 51', (cursor['createdAt'], cursor['createdAt'], cursor['id'])).fetchall()
        else:
            rows = self.db.execute('SELECT * FROM history ORDER BY createdAt DESC, id DESC LIMIT 51').fetchall()
        return {'entries': [self.history_row(row) for row in rows[:50]], 'hasMore': len(rows) > 50}

    def handle(self, method, params):
        if method == 'account.delete': return self.delete_account(params.get('userId'))
        if method == 'account.select': return self.select_account(params.get('userId'))
        if method == 'ping': return {'ready': True, 'platform': sys.platform, 'capabilities': ['preferences', 'history', 'insights']}
        if method == 'snapshot': return self.snapshot()
        if method == 'history.get': return self.history_get(params['id'])
        if method == 'history.list': return self.history_page(params.get('cursor'))
        if method == 'history.create':
            entry = params['entry']
            with self.db:
                self.db.execute('INSERT OR IGNORE INTO history (id, createdAt, text, words, durationMs, status, error, originalText, language, cleanupEnabled, audioMimeType, audioBytes) VALUES (:id, :createdAt, :text, :words, :durationMs, :status, :error, :originalText, :language, :cleanupEnabled, :audioMimeType, :audioBytes)', entry)
            return self.history_get(entry['id'])
        if method == 'history.update':
            entry = params['entry']
            with self.db:
                current = self.history_get(entry['id'])
                if not current: return None
                self.db.execute('UPDATE history SET text=:text, words=:words, status=:status, error=:error, originalText=:originalText, language=:language, cleanupEnabled=:cleanupEnabled WHERE id=:id', entry)
                if entry['status'] == 'completed' and entry['words'] > 0:
                    self.db.execute('INSERT OR IGNORE INTO metrics VALUES (?, ?, ?, ?)', (entry['id'], params['day'], entry['words'], current['durationMs']))
            return self.history_get(entry['id'])
        if method == 'preferences': return self.preferences(params)
        if method == 'delete':
            with self.db: self.db.execute('DELETE FROM history WHERE id = ?', (params['id'],))
            return None
        raise ValueError('Unsupported method')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', required=True)
    args = parser.parse_args()
    store = Store(Path(args.data_dir) / 'history.sqlite3')
    output_lock = threading.Lock()

    def write(payload):
        with output_lock:
            print(json.dumps(payload), flush=True)

    native = WindowsService(lambda event, data: write({'event': event, 'data': data}))
    delivery_threads = []
    def deliver(request):
        try:
            result = native.call('insert-text', request.get('params', {}))
            write({'id': request['id'], 'result': result})
        except Exception:
            write({'id': request.get('id'), 'error': 'Text insertion could not complete'})

    for line in sys.stdin:
        request = {}
        try:
            # A history update can contain two escaped 24,000-character transcripts.
            if len(line) > 512 * 1024: raise ValueError('Request too large')
            request = json.loads(line)
            method = request['method']
            params = request.get('params', {})
            if not isinstance(params, dict):
                raise ValueError('Invalid parameters')
            if method == 'windows.insert-text':
                delivery_threads = [thread for thread in delivery_threads if thread.is_alive()]
                if delivery_threads:
                    raise ValueError('Insertion is already running')
                thread = threading.Thread(target=deliver, args=(request,), daemon=True)
                delivery_threads.append(thread)
                thread.start()
                continue
            result = native.call(method[8:], params) if method.startswith('windows.') else store.handle(method, params)
            response = {'id': request['id'], 'result': result}
        except Exception:
            response = {'id': request.get('id'), 'error': 'Local operation failed'}
        write(response)
    native.close()
    store.db.close()


if __name__ == '__main__':
    main()

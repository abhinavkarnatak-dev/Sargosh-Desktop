"""Local-only storage and process bridge. Never communicates with cloud services."""
import argparse
import json
import sqlite3
import sys
import threading
from native_control import WindowsService
from pathlib import Path


class Store:
    def __init__(self, path):
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
            'history': [dict(row) for row in self.db.execute('SELECT * FROM history ORDER BY createdAt DESC LIMIT 200')],
            'activity': [dict(row) for row in self.db.execute('SELECT day date, SUM(words) words FROM metrics GROUP BY day ORDER BY day')],
            'totalWords': totals['words'], 'recordingCount': totals['count'], 'totalDurationMs': totals['duration']
        }

    def add(self, entry, day):
        # Retries update history, but cannot count another recording or alter earned metrics.
        with self.db:
            self.db.execute('INSERT OR REPLACE INTO history VALUES (:id, :createdAt, :text, :words, :durationMs, :status, :error)', {**entry, 'error': entry.get('error')})
            if entry['status'] == 'completed':
                self.db.execute('INSERT OR IGNORE INTO metrics VALUES (?, ?, ?, ?)', (entry['id'], day, entry['words'], entry['durationMs']))

    def handle(self, method, params):
        if method == 'ping': return {'ready': True, 'platform': sys.platform, 'capabilities': ['preferences', 'history', 'insights']}
        if method == 'snapshot': return self.snapshot()
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
            if len(line) > 65536: raise ValueError('Request too large')
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

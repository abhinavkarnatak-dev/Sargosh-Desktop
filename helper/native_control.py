"""Opt-in development proof for Windows input. No microphone or cloud access."""
import copy
import os
import queue
import sys
import threading
from destinations import DestinationSession
from shortcuts import parse_shortcut


def initial_state():
    return {'revision': 0, 'enabled': False, 'shortcut': 'Control+Alt+Space', 'phase': 'idle', 'mode': None,
            'sessionId': None, 'target': None, 'deliveryAttempted': False,
            'message': 'Start the Windows input test to check shortcuts and destinations.'}


class WindowsService:
    def __init__(self, emit):
        self.emit = emit
        self.events = queue.Queue()
        self.lock = threading.Lock()
        self.state = initial_state()
        self.worker = None
        self.keyboard = None
        self.uia = None
        self.session = DestinationSession()
        self.generation = 0

    def status(self):
        with self.lock:
            return copy.deepcopy(self.state)

    def _publish(self, message=None):
        state = {'revision': self.state['revision'] + 1, 'enabled': self.uia is not None and self.keyboard is not None,
                 'shortcut': self.state['shortcut'], **self.session.snapshot()}
        if message:
            state['message'] = message
        with self.lock:
            self.state = state
        self.emit('windows.state', copy.deepcopy(state))
        return state

    def call(self, method, params=None):
        params = params or {}
        if method == 'status':
            return self.status()
        if method == 'arm':
            parse_shortcut(params.get('shortcut'))
            ignored = params.get('ignoredProcessIds', [])
            if not isinstance(ignored, list) or len(ignored) > 100 or any(type(pid) is not int or pid <= 0 for pid in ignored):
                raise ValueError('Invalid process exclusions')
        if sys.platform != 'win32':
            raise ValueError('Windows input testing requires Windows')
        if self.worker is None:
            self.worker = threading.Thread(target=self._run, daemon=True)
            self.worker.start()
        response = queue.Queue(maxsize=1)
        self.events.put(('command', (method, params, response)))
        try:
            result = response.get(timeout=4)
        except queue.Empty:
            raise ValueError('The Windows helper did not respond. Restart the desktop app.')
        if isinstance(result, Exception):
            raise result
        return result

    def close(self):
        if self.worker and self.worker.is_alive():
            response = queue.Queue(maxsize=1)
            self.events.put(('command', ('shutdown', {}, response)))
            self.worker.join(timeout=3)

    def _release(self):
        self.generation += 1
        keyboard, uia = self.keyboard, self.uia
        self.keyboard = self.uia = None
        try:
            if keyboard:
                keyboard.stop()
        finally:
            if uia:
                try:
                    uia.close()
                except Exception:
                    pass

    def _run(self):
        try:
            while True:
                kind, payload = self.events.get()
                if kind == 'command':
                    method, params, response = payload
                    try:
                        result = self._command(method, params)
                        response.put(result)
                    except Exception:
                        response.put(ValueError('The Windows input operation could not complete. Restart the test and check the destination.'))
                    if method == 'shutdown':
                        break
                elif self.uia and kind == 'focus' and payload[0] == self.generation:
                    try:
                        if self.session.observe(self.uia.capture(payload[1])):
                            self.uia.retain(self.session.target.token if self.session.target else None)
                            self._publish()
                    except Exception:
                        # A control may disappear while Windows is reporting its focus.
                        pass
                elif self.uia and kind == 'gesture' and payload[0] == self.generation:
                    try:
                        self._gesture(payload[1])
                    except Exception:
                        self.session.cancel()
                        self._publish('The input target became unavailable. Start a new test.')
        finally:
            self._release()

    def _gesture(self, gesture):
        if gesture in ('prepare', 'finish'):
            self.session.observe(self.uia.focused())
        if gesture == 'prepare':
            self.session.prepare()
        elif gesture == 'start-hold':
            self.session.start('hold')
        elif gesture == 'start-hands-free':
            self.session.start('hands-free')
        elif gesture == 'finish':
            self.session.finish()
        elif gesture == 'cancel-pending':
            self.session.cancel()
        self.uia.retain(self.session.target.token if self.session.target else None)
        self._publish()

    def _command(self, method, params):
        if method == 'arm':
            self._release()
            self.session = DestinationSession()
            self.state['shortcut'] = params['shortcut']
            try:
                from windows_uia import UIAutomation
                from windows_keyboard import KeyboardHook
                self.uia = UIAutomation(self.events, params.get('ignoredProcessIds', []), self.generation)
                self.keyboard = KeyboardHook(params['shortcut'], self.events, self.generation)
                self.keyboard.start()
                self.session.observe(self.uia.focused())
                return self._publish()
            except Exception:
                self._release()
                self.session.phase = 'failed'
                return self._publish('Windows input access is unavailable. Run Sargosh from a normal Windows terminal and check the Python setup.')
        if method in ('disarm', 'shutdown'):
            self._release()
            self.session.cancel()
            return self._publish('Windows input test stopped. The keyboard hook has been removed.')
        if not self.uia or not self.keyboard:
            raise ValueError('Start the Windows input test first')
        if method == 'cancel':
            self.session.cancel()
            self.keyboard.reset()
            return self._publish()
        if method == 'start-hands-free':
            self.session.observe(self.uia.focused())
            if self.session.prepare():
                self.session.start('hands-free')
            self.keyboard.commands.put('hands-free')
            return self._publish()
        if method == 'finish':
            self.session.observe(self.uia.focused())
            self.session.finish()
            self.keyboard.reset()
            self.uia.retain(self.session.target.token if self.session.target else None)
            return self._publish()
        if method == 'insert-test':
            destination = self.session.claim_delivery(params.get('sessionId'))
            try:
                result = self.uia.insert_test(destination)
                return self._publish(result['message'])
            except Exception:
                return self._publish('Delivery could not be confirmed. Check the destination. Automatic retries are disabled.')
        raise ValueError('Unsupported Windows operation')

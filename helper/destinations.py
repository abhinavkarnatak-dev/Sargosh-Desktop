"""Session and destination rules independent of Windows or COM."""
from dataclasses import dataclass
from uuid import uuid4


@dataclass(frozen=True)
class Destination:
    token: str
    application: str
    process_id: int
    protected: bool = False

    def public(self):
        return {'id': self.token, 'application': self.application}


class DestinationSession:
    def __init__(self):
        self.phase = 'idle'
        self.mode = None
        self.id = None
        self.last = None
        self.target = None
        self.delivery_attempted = False
        self.message = 'Windows input test is ready. No audio is recorded.'

    def observe(self, destination):
        # None means a non-editable control, not a request to erase the destination.
        if destination is None:
            return False
        self.last = None if destination.protected else destination
        if self.phase in ('pending', 'listening'):
            self.target = self.last
        if destination.protected:
            self.message = 'Password fields are excluded. Select another input.'
        return True

    def prepare(self):
        if self.phase in ('pending', 'listening'):
            return False
        self.id = str(uuid4())
        self.phase = 'pending'
        self.mode = None
        self.target = self.last
        self.delivery_attempted = False
        self.message = 'Recognizing your shortcut. No audio is recorded in this test.'
        return True

    def start(self, mode):
        if self.phase != 'pending' or mode not in ('hold', 'hands-free'):
            return False
        self.phase = 'listening'
        self.mode = mode
        self.message = 'Shortcut active. Input tracking only; the microphone is off.'
        return True

    def finish(self):
        if self.phase != 'listening':
            return False
        self.phase = 'finished'
        self.message = 'Destination frozen. You can insert the fixed test sentence.'
        return True

    def cancel(self):
        if self.phase not in ('pending', 'listening', 'finished'):
            return False
        self.phase = 'cancelled'
        self.target = None
        self.message = 'Input test cancelled. Nothing was inserted.'
        return True

    def claim_delivery(self, session_id):
        if self.phase != 'finished' or self.id != session_id or self.delivery_attempted:
            raise ValueError('This session cannot insert text')
        if self.target is None or self.target.protected:
            raise ValueError('No eligible destination was selected')
        # Claim before touching Windows. Uncertain results must never be retried automatically.
        self.delivery_attempted = True
        return self.target

    def snapshot(self):
        return {
            'phase': self.phase, 'mode': self.mode, 'sessionId': self.id,
            'target': self.target.public() if self.target else None,
            'deliveryAttempted': self.delivery_attempted, 'message': self.message
        }

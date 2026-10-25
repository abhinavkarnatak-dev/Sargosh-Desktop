"""Deterministic shortcut interpretation. No Windows calls and no key logging."""
from dataclasses import dataclass


MODIFIERS = ('Control', 'Alt', 'Shift', 'Win')
KEYS = {'Space': 0x20, **{chr(code): code for code in range(65, 91)},
        **{f'F{index}': 0x6F + index for index in range(1, 25)}}


def parse_shortcut(value):
    if not isinstance(value, str) or len(value) > 80:
        raise ValueError('Invalid shortcut')
    parts = value.split('+')
    if len(parts) != len(set(parts)) or len(parts) < 2:
        raise ValueError('Use a modifier and a letter, function key, or Space')
    modifiers = {part for part in parts if part in MODIFIERS}
    keys = [part for part in parts if part not in MODIFIERS]
    if not modifiers or len(keys) != 1 or keys[0] not in KEYS:
        raise ValueError('Use a modifier and a letter, function key, or Space')
    if 'Control' not in modifiers and 'Alt' not in modifiers and 'Win' not in modifiers:
        raise ValueError('Include Control, Alt, or Win')
    if value in ('Alt+F4', 'Control+Alt+Delete', 'Win+L'):
        raise ValueError('Choose a non-system shortcut')
    return modifiers, KEYS[keys[0]]


@dataclass
class Gesture:
    hold_seconds: float = 0.18
    double_tap_seconds: float = 0.32
    state: str = 'idle'
    down_at: float | None = None
    first_up: float | None = None
    swallowed_until_up: bool = False
    ignore_hands_free_release: bool = False

    def press(self, now):
        events = self.tick(now)
        if self.down_at is not None or self.swallowed_until_up:
            return events
        self.down_at = now
        if self.state == 'idle':
            self.state = 'pending'
            events.append('prepare')
        elif self.state == 'waiting':
            self.state = 'hands-free'
            self.ignore_hands_free_release = True
            self.first_up = None
            events.append('start-hands-free')
        elif self.state == 'hands-free' and self.first_up is not None:
            self.state = 'idle'
            self.first_up = None
            self.swallowed_until_up = True
            events.append('finish')
        return events

    def release(self, now):
        events = self.tick(now)
        if self.swallowed_until_up:
            self.swallowed_until_up = False
            self.down_at = None
            return events
        if self.down_at is None:
            return events
        duration = now - self.down_at
        self.down_at = None
        if self.state == 'hold':
            self.state = 'idle'
            events.append('finish')
        elif self.state == 'pending':
            self.state = 'waiting'
            self.first_up = now
        elif self.state == 'hands-free' and self.ignore_hands_free_release:
            self.ignore_hands_free_release = False
        elif self.state == 'hands-free':
            self.first_up = now if duration < self.hold_seconds else None
        return events

    def tick(self, now):
        if self.state == 'pending' and self.down_at is not None and now - self.down_at >= self.hold_seconds:
            self.state = 'hold'
            return ['start-hold']
        if self.first_up is not None and now - self.first_up > self.double_tap_seconds:
            self.first_up = None
            if self.state == 'waiting':
                self.state = 'idle'
                return ['cancel-pending']
        return []

    def reset(self):
        self.state = 'idle'
        self.ignore_hands_free_release = False
        self.down_at = None
        self.first_up = None
        self.swallowed_until_up = False

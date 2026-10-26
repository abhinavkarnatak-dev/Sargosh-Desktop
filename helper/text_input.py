"""Build keyboard events without accessing Windows or document contents."""
KEY_UP = 0x0002
UNICODE = 0x0004
SHIFT = 0x10


def character_events(character, mapping=-1, caps_lock=False):
    # Only ordinary printable ASCII uses layout-mapped keys. Never synthesize
    # Ctrl/Alt/AltGr combinations, which could execute application commands.
    if len(character) != 1:
        raise ValueError('Expected one Unicode character')
    if character == '\n':
        # Chat editors commonly submit on Enter; Shift+Enter inserts a line break.
        return [(SHIFT, 0, 0), (0x0d, 0, 0), (0x0d, 0, KEY_UP), (SHIFT, 0, KEY_UP)]
    shift_state = (mapping >> 8) & 0xff
    key = mapping & 0xff
    if 0x20 <= ord(character) <= 0x7e and mapping != -1 and shift_state in (0, 1) and 0 < key < 255:
        shifted = bool(shift_state)
        if character.isascii() and character.isalpha() and caps_lock:
            shifted = not shifted
        events = [(SHIFT, 0, 0)] if shifted else []
        events.extend([(key, 0, 0), (key, 0, KEY_UP)])
        if shifted:
            events.append((SHIFT, 0, KEY_UP))
        return events
    encoded = character.encode('utf-16-le')
    events = []
    for index in range(0, len(encoded), 2):
        unit = int.from_bytes(encoded[index:index + 2], 'little')
        events.extend([(0, unit, UNICODE), (0, unit, UNICODE | KEY_UP)])
    return events

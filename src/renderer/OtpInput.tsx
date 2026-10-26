import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { isEmailCode } from '../shared/auth';
interface Props { id: string; value: string; disabled?: boolean; inputRef: RefObject<HTMLInputElement | null>; onChange(value: string): void; onInvalid(message: string): void }
export function OtpInput({ id, value, disabled, inputRef, onChange, onInvalid }: Props) {
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const pending = useRef<{ start: number; end: number } | null>(null);
  function readSelection() {
    const input = inputRef.current;
    if (input) setSelection({ start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0 });
  }
  function change(next: string, start: number, end = start) {
    const range = { start, end };
    if (next === value) { inputRef.current?.setSelectionRange(start, end); pending.current = null; }
    else pending.current = range;
    setSelection(range); onChange(next);
  }
  useLayoutEffect(() => {
    if (pending.current) { inputRef.current?.setSelectionRange(pending.current.start, pending.current.end); pending.current = null; }
  }, [value, inputRef]);
  const active = Math.min(selection.start, 5);
  return <div className={'otp-input' + (disabled ? ' disabled' : '')}>
    <div className="otp-digits" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <span key={index} className="otp-digit" data-active={index === active} data-selected={selection.end > selection.start && index >= selection.start && index < selection.end}>{value[index] ?? ''}</span>)}</div>
    <input ref={inputRef} id={id} className="otp-native-input" type="text" inputMode="numeric" autoComplete="one-time-code" spellCheck={false} pattern="[0-9]{6}" maxLength={6} required value={value} disabled={disabled} autoFocus aria-describedby={id + '-help'}
      onChange={event => {
        const raw = event.currentTarget.value, next = raw.replace(/[^0-9]/g, '');
        if (next.length > 6) { onInvalid('Enter the 6-digit OTP from the latest email.'); return; }
        change(next, raw.slice(0, event.currentTarget.selectionStart ?? raw.length).replace(/[^0-9]/g, '').length);
      }}
      onPaste={event => {
        event.preventDefault(); const next = event.clipboardData.getData('text').replace(/\s/g, '');
        if (!isEmailCode(next)) { onInvalid('Enter the 6-digit OTP from the latest email.'); return; }
        change(next, 6);
      }}
      onFocus={readSelection} onSelect={readSelection} onKeyUp={readSelection}
      onPointerDown={event => {
        if (disabled || event.button !== 0) return;
        event.preventDefault(); const input = event.currentTarget, bounds = input.getBoundingClientRect();
        const digit = Math.min(value.length, 5, Math.max(0, Math.floor((event.clientX - bounds.left) / (bounds.width / 6))));
        input.focus(); input.setSelectionRange(digit, Math.min(digit + 1, value.length)); readSelection();
      }} />
  </div>;
}

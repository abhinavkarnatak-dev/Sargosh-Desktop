import { useEffect, useState, type CSSProperties } from 'react';

const DURATION_MS = 480;

// Keep a running roll intact. If another update arrives, roll to the latest value next.
export function RollingNumber({ value }: { value: number }) {
  const [roll, setRoll] = useState({ from: value, to: value });
  useEffect(() => {
    if (roll.from === roll.to && roll.to !== value) {
      setRoll({ from: roll.to, to: value });
    }
  }, [value, roll.from, roll.to]);
  useEffect(() => {
    if (roll.from === roll.to) return;
    const timer = window.setTimeout(() => setRoll({ from: roll.to, to: roll.to }), DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [roll.from, roll.to]);

  const previous = String(roll.from).padStart(String(roll.to).length, '0');
  const digits = String(roll.to);
  const increasing = roll.to >= roll.from;
  let place = digits.length;
  return <span className="rolling-number" role="img" aria-label={value.toLocaleString()}>
    <span className="rolling-number-visual" aria-hidden="true">{Array.from(roll.to.toLocaleString()).map((character, index) => {
      if (!/[0-9]/.test(character)) return <span key={'separator-' + index}>{character}</span>;
      const position = digits.length - place--;
      const oldDigit = Number(previous[previous.length - digits.length + position]);
      const newDigit = Number(character);
      const steps = increasing ? (newDigit - oldDigit + 10) % 10 : (oldDigit - newDigit + 10) % 10;
      const sequence = Array.from({ length: steps + 1 }, (_, step) => (oldDigit + (increasing ? step : -step) + 10) % 10);
      if (!increasing) sequence.reverse();
      const end = -steps * 1.2;
      const style = { '--roll-start': `${increasing ? 0 : end}em`, '--roll-end': `${increasing ? end : 0}em` } as CSSProperties;
      return <span className="rolling-digit" key={'place-' + (digits.length - position)}>
        <span className="rolling-digit-track" key={`${roll.from}:${roll.to}`} style={style}>{sequence.map((digit, step) => <span key={step}>{digit}</span>)}</span>
      </span>;
    })}</span>
  </span>;
}

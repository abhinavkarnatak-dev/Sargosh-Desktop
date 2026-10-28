import { useEffect, useState, type CSSProperties } from 'react';

const DURATION_MS = 480;

// Keep a running roll intact. If another update arrives, roll to the latest value next.
export function RollingNumber({ value, compact = false }: { value: number; compact?: boolean }) {
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

  const scale = compact && roll.to >= 1000 ? 1000 : 1;
  const displayValue = (count: number) => scale === 1000 ? Math.floor(count / 100) / 10 : count;
  const formatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: scale === 1000 ? 1 : 0 });
  const formatted = compact ? formatter.format(displayValue(roll.to)) : roll.to.toLocaleString();
  const precision = formatter.formatToParts(displayValue(roll.to)).find(part => part.type === 'fraction')?.value.length ?? 0;
  const digits = compact ? formatted.replace(/\D/g, '') : String(roll.to);
  const previous = compact
    ? new Intl.NumberFormat(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision }).format(displayValue(roll.from)).replace(/\D/g, '').padStart(digits.length, '0')
    : String(roll.from).padStart(String(roll.to).length, '0');
  const increasing = roll.to >= roll.from;
  let place = digits.length;
  return <span className="rolling-number" role="img" aria-label={value.toLocaleString()}>
    <span className="rolling-number-visual" aria-hidden="true">{Array.from(formatted + (scale === 1000 ? 'K' : '')).map((character, index) => {
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

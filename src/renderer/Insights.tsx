import { WaveHeading } from './WaveHeading';
import { CalendarDays, ChevronLeft, ChevronRight, FileAudio, Gauge, Mic } from 'lucide-react';
import { activityDays, localDate, streaks, wordsPerMinute } from '../shared/insights';
import type { Snapshot } from '../shared/types';
import { useState } from 'react';
import { RollingNumber } from './RollingNumber';
import { createPortal } from 'react-dom';
export function Insights({ snapshot }: { snapshot: Snapshot }) {
  const [offset, setOffset] = useState(0);
  const [tooltip, setTooltip] = useState<{ label: string; words: number; x: number; y: number } | null>(null);
  function showDay(element: HTMLElement, label: string, words: number) {
    const bounds = element.getBoundingClientRect();
    setTooltip({ label, words, x: Math.max(100, Math.min(window.innerWidth - 100, bounds.left + bounds.width / 2)), y: bounds.top - 8 });
  }
  const end = new Date(); end.setDate(end.getDate() + offset * 140);
  const days = activityDays(end);
  const today = localDate(new Date());
  const activity = new Map(snapshot.activity.map(day => [day.date, day.words]));
  const streak = streaks(snapshot.activity);
  const maximum = Math.max(1, ...days.map(date => activity.get(date) || 0));
  const months = days.filter((date, index) => index % 7 === 0).map((date, index, weeks) => index === 0 || date.slice(0, 7) !== weeks[index - 1].slice(0, 7) ? new Date(date + 'T12:00:00').toLocaleString([], { month: 'short' }) : '');
  const stats = [
    { label: 'WORDS PER MINUTE', value: wordsPerMinute(snapshot.totalWords, snapshot.totalDurationMs), detail: 'Your average speaking pace', Icon: Gauge },
    { label: 'TOTAL WORDS', value: snapshot.totalWords, detail: 'Thoughts turned into text', Icon: Mic },
    { label: 'RECORDINGS', value: snapshot.recordingCount, detail: 'Successful dictation sessions', Icon: FileAudio }
  ];
  return <>
    <div className="page-heading"><div><p className="eyebrow">INSIGHTS</p><WaveHeading>A little progress. Every day.</WaveHeading><p className="subtitle">A quiet look at how you use your voice.</p></div></div>
    <div className="insight-cards">{stats.map(({ label, value, detail, Icon }) => <section className="metric-card" key={label}><Icon size={20} strokeWidth={1.5} /><strong><RollingNumber value={value} compact={label === 'TOTAL WORDS'} /></strong><span className="eyebrow">{label}</span><p>{detail}</p></section>)}</div>
    <section className="activity-card" aria-labelledby="activity-heading">
      <div className="activity-title"><div><span className="eyebrow">KEEP SHOWING UP</span><h2 id="activity-heading">{streak.current} day streak</h2></div><span className="longest">Longest streak <strong>{streak.longest} days</strong></span></div>
      <div className="calendar-controls"><button className="icon-button" aria-label="Previous activity period" onClick={() => setOffset(value => value - 1)}><ChevronLeft size={17} /></button><span>{new Date(days[0] + 'T12:00:00').toLocaleDateString([], { month: 'short', year: 'numeric' })} - {new Date(days[days.length - 1] + 'T12:00:00').toLocaleDateString([], { month: 'short', year: 'numeric' })}</span><button className="icon-button" aria-label="Next activity period" disabled={offset >= 0} onClick={() => setOffset(value => value + 1)}><ChevronRight size={17} /></button></div>
      <div className="calendar-scroll"><div className="calendar-body"><div className="weekdays"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div><div className="calendar-right"><div className="month-labels">{months.map((month, index) => <span key={index}>{month}</span>)}</div><div className="heatmap">{days.map((date, index) => {
        const words = activity.get(date) || 0;
        const level = words === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(words / maximum * 4)));
        const label = new Date(date + 'T12:00:00').toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
        return <button type="button" key={date} style={{ animationDelay: `${Math.floor(index / 7) * 28}ms` }} className={`day-cell level-${level}${date > today ? ' future' : ''}`} aria-label={label + ': ' + words.toLocaleString() + ' words'} data-tooltip="" disabled={date > today} onMouseEnter={event => showDay(event.currentTarget, label, words)} onMouseLeave={() => setTooltip(null)} onFocus={event => showDay(event.currentTarget, label, words)} onBlur={() => setTooltip(null)} />;
      })}</div></div></div></div>
      <div className="calendar-bottom"><span><CalendarDays size={14} /> Small moments add up.</span><div className="legend"><span>Less</span>{[0, 1, 2, 3, 4].map(level => <i className={'level-' + level} key={level} />)}<span>More</span></div></div>
    </section>
    {tooltip && createPortal(<div className="floating-day-tooltip" role="tooltip" style={{ left: tooltip.x, top: tooltip.y }}><strong>{tooltip.label}</strong><span>{tooltip.words.toLocaleString()} words</span></div>, document.body)}
    {!snapshot.recordingCount && <p className="insight-empty">Your activity will grow here as you dictate. No comparisons, just your progress.</p>}
  </>;
}

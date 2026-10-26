import { shortcutLabel } from '../shared/shortcut-label';
import { useEffect, useRef, useState } from 'react';
import { activateShortcuts } from './activate-shortcuts';
import type { Preferences } from '../shared/types';
export function DictationGuide({ preferences, enabled }: { preferences: Preferences; enabled: boolean }) {
  const [error, setError] = useState('');
  const [available, setAvailable] = useState<boolean | null>(null);
  const [activating, setActivating] = useState(false);
  const [revision, setRevision] = useState(0);
  const shortcut = useRef(preferences.shortcut); shortcut.current = preferences.shortcut;
  useEffect(() => {
    if (!enabled || !window.sargosh?.startWindowsRecording) return;
    let alive = true; setError(''); setActivating(true);
    const unsubscribe = window.sargosh.onWindowsState?.(state => { if (alive) setAvailable(state.enabled && state.purpose === 'recording'); });
    void activateShortcuts(shortcut.current).then(() => { if (alive) setAvailable(true); }, failure => { if (alive) setError(failure instanceof Error ? failure.message : 'Your shortcut could not start. Please try again.'); }).finally(() => { if (alive) setActivating(false); });
    return () => { alive = false; unsubscribe?.(); };
  }, [enabled, revision]);
  const keys = shortcutLabel(preferences.shortcut).split(' + ');
  return <section className="dictation-guide" aria-label="How to dictate">
    <p className="eyebrow">YOUR VOICE, EVERYWHERE</p>
    <h2>Hold <span className="dictation-keyboard">{keys.map((key, index) => <span className="shortcut-key-unit" key={index}>{index > 0 && <span className="shortcut-plus" aria-hidden="true">+</span>}<kbd>{key}</kbd></span>)}</span> to dictate.</h2>
    <p className="dictation-guide-description">Place your cursor in any app and speak naturally. Sargosh turns your words into clear, ready-to-use text.</p>
    <p className="dictation-guide-hint">Release to finish. Double-tap for hands-free dictation.</p>
    {enabled && !activating && (error || available === false) && <div className="dictation-shortcut-error" role="alert"><p>{error || 'Recording shortcuts are paused. Resume them when you are ready.'}</p><button className="text-button" onClick={() => setRevision(value => value + 1)}>Try again</button></div>}
  </section>;
}

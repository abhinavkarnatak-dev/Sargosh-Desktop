import { useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
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
  return <section className="dictation-guide" aria-label="How to dictate"><Mic size={20} /><div><h2>Speak freely. Sargosh takes care of the typing.</h2><p>Click a textbox in any app. Hold <kbd>{preferences.shortcut.split('+').join(' + ')}</kbd> to dictate, then release to finish.</p><p>Double-tap the same shortcut to speak hands-free. Double-tap again to finish.</p></div>{enabled && !activating && (error || available === false) && <div className="dictation-shortcut-error" role="alert"><p>{error || 'Recording shortcuts are paused. Resume them when you are ready.'}</p><button className="text-button" onClick={() => setRevision(value => value + 1)}>Try again</button></div>}</section>;
}

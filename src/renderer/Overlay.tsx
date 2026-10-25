import { useEffect, useRef, useState } from 'react';
import { Check, GripVertical, Mic, X } from 'lucide-react';
import { INITIAL_WINDOWS_STATE, type WindowsState } from '../shared/windows';
export function Overlay() {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<WindowsState>(INITIAL_WINDOWS_STATE);
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!window.sargosh) return;
    const update = (next: WindowsState) => setState(current => next.revision >= current.revision ? next : current);
    const unsubscribe = window.sargosh.onWindowsState(update);
    void window.sargosh.windowsStatus().then(update).catch(() => {});
    return unsubscribe;
  }, []);
  const active = state.enabled && ['pending', 'listening'].includes(state.phase);
  async function action(value: 'cancel' | 'finish' | 'start-hands-free') {
    try { const next = await window.sargosh?.windowsAction(value); if (next) setState(current => next.revision >= current.revision ? next : current); }
    catch { setState(current => ({ ...current, enabled: false, phase: 'failed', message: 'Windows input test is unavailable. Open Sargosh to restart it.' })); }
  }
  return <div className="overlay-stage">
    <div className={(expanded || active ? 'overlay-pill expanded' : 'overlay-pill') + (active ? ' input-test-active' : '')} onMouseEnter={() => setExpanded(true)} onMouseLeave={() => { if (!drag.current) setExpanded(false); }}>
      {active ? <>
        <button className="overlay-mic" aria-label="Cancel input test session" title="Cancel" onClick={() => void action('cancel')}><X size={15} /></button>
        <span className="overlay-test-label" title="Input tracking only. No audio is recorded.">{state.phase === 'pending' ? 'Starting test' : state.mode === 'hold' ? 'Hold test' : 'Input test'}</span>
        {state.mode === 'hands-free' && <button className="overlay-mic" aria-label="Finish input test session" title="Finish input test" onClick={() => void action('finish')}><Check size={15} /></button>}
      </> : expanded ? <>
        <button className="overlay-grip" aria-label="Move dictation control" onPointerDown={event => { drag.current = { x: event.screenX, y: event.screenY }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (!drag.current) return; const dx = event.screenX - drag.current.x; const dy = event.screenY - drag.current.y; drag.current = { x: event.screenX, y: event.screenY }; void window.sargosh?.moveOverlay(dx, dy); }} onPointerUp={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}><GripVertical size={15} /></button>
        <button className="overlay-mic" aria-label={state.enabled ? 'Start hands-free input test' : 'Open Sargosh to set up dictation'} title={state.enabled ? 'Start input test' : 'Set up dictation in Sargosh'} onClick={() => state.enabled ? void action('start-hands-free') : void window.sargosh?.openMain()}><Mic size={19} /></button>
        <span className="overlay-tooltip">{state.enabled ? 'Input test - ' + state.shortcut : 'Set up dictation in Sargosh'}</span>
      </> : <span className="idle-line" />}
    </div>
  </div>;
}

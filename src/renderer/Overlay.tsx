import { useRef, useState } from 'react';
import { GripVertical, Mic } from 'lucide-react';
export function Overlay() {
  const [expanded, setExpanded] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  return <div className="overlay-stage">
    <div className={expanded ? 'overlay-pill expanded' : 'overlay-pill'} onMouseEnter={() => setExpanded(true)} onMouseLeave={() => { if (!drag.current) setExpanded(false); }}>
      {expanded ? <>
        <button className="overlay-grip" aria-label="Move dictation control" onPointerDown={event => { drag.current = { x: event.screenX, y: event.screenY }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (!drag.current) return; const dx = event.screenX - drag.current.x; const dy = event.screenY - drag.current.y; drag.current = { x: event.screenX, y: event.screenY }; void window.sargosh?.moveOverlay(dx, dy); }} onPointerUp={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}><GripVertical size={15} /></button>
        <button className="overlay-mic" aria-label="Open Sargosh to set up dictation" title="Set up dictation in Sargosh" onClick={() => void window.sargosh?.openMain()}><Mic size={19} /></button>
        <span className="overlay-tooltip">Set up dictation in Sargosh</span>
      </> : <span className="idle-line" />}
    </div>
  </div>;
}

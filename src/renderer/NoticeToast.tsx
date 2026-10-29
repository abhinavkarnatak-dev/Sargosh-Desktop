import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModalLayer } from './modal';
import { AlertCircle, Check, Info, X } from 'lucide-react';
export function NoticeToast({ message, onDismiss, variant }: { message: string; onDismiss(): void; variant?: 'success' | 'notice' | 'info' | 'warning' }) {
  const layer = useModalLayer();
  const toast = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = toast.current; if (!element) return;
    // A manual popover renders above the modal without adding a backdrop or
    // moving focus. Keeping it inside the active dialog also keeps it clickable.
    try { element.showPopover?.(); } catch { /* Retried when the modal layer opens. */ }
    return () => { if (element.isConnected) element.hidePopover?.(); };
  }, [layer]);
  const success = variant ? variant==='success' : ['Transcript copied.', 'Transcript and recording deleted.', 'Original audio saved.'].includes(message);
  const brief=success || variant==='info';
  useEffect(() => { const timer = setTimeout(onDismiss, brief ? 2000 : 7000); return () => clearTimeout(timer); }, [message, brief, onDismiss]);
  const content = <div ref={toast} popover="manual" className={'toast' + (brief ? ' success-toast' : '')} role="status">{variant==='warning'?<AlertCircle size={16} />:variant==='info'?<Info size={16} />:<Check size={16} />}<span>{message}</span>{!brief && <button className="icon-button" aria-label="Dismiss message" onClick={onDismiss}><X size={15} /></button>}</div>;
  return layer ? createPortal(content, layer) : content;
}

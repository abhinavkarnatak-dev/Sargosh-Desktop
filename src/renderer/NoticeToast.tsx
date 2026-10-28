import { useEffect } from 'react';
import { Check, Info, X } from 'lucide-react';
export function NoticeToast({ message, onDismiss, variant }: { message: string; onDismiss(): void; variant?: 'success' | 'notice' | 'info' }) {
  const success = variant ? variant==='success' : ['Transcript copied.', 'Transcript and recording deleted.', 'Original audio saved.'].includes(message);
  const brief=success || variant==='info';
  useEffect(() => { const timer = setTimeout(onDismiss, brief ? 2000 : 7000); return () => clearTimeout(timer); }, [message, brief, onDismiss]);
  return <div className={'toast' + (brief ? ' success-toast' : '')} role="status">{variant==='info'?<Info size={16} />:<Check size={16} />}<span>{message}</span>{!brief && <button className="icon-button" aria-label="Dismiss message" onClick={onDismiss}><X size={15} /></button>}</div>;
}

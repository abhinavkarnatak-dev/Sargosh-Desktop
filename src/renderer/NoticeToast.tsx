import { useEffect } from 'react';
import { Check, X } from 'lucide-react';
export function NoticeToast({ message, onDismiss }: { message: string; onDismiss(): void }) {
  const success = ['Transcript copied.', 'Transcript and recording deleted.', 'Original audio saved.'].includes(message);
  useEffect(() => { const timer = setTimeout(onDismiss, success ? 2000 : 7000); return () => clearTimeout(timer); }, [message, success, onDismiss]);
  return <div className={'toast' + (success ? ' success-toast' : '')} role="status"><Check size={16} /><span>{message}</span>{!success && <button className="icon-button" aria-label="Dismiss message" onClick={onDismiss}><X size={15} /></button>}</div>;
}

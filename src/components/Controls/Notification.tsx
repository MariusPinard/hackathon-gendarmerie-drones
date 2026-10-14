import { useEffect } from 'react';

export interface Notice { kind: 'success' | 'error' | 'info'; message: string; id: number }

export function Notification({ notice, onClose }: { notice: Notice | null; onClose: () => void }) {
  useEffect(() => { if (!notice || notice.kind === 'error') return; const timer = setTimeout(onClose, 6000); return () => clearTimeout(timer); }, [notice?.id]);
  if (!notice) return null;
  return <div className={`toast ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
    <span className="toast-icon" aria-hidden="true">{notice.kind === 'success' ? '✓' : notice.kind === 'error' ? '!' : 'i'}</span>
    <span>{notice.message}</span><button aria-label="Fermer la notification" onClick={onClose}>×</button>
  </div>;
}

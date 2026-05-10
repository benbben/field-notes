import { useEffect } from 'react';
export default function Modal({ open, onClose, title, children, footer }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-bg-1 w-full md:w-[420px] md:rounded-2xl rounded-t-2xl border-t md:border border-bg-3 p-4 max-h-[85vh] flex flex-col"
           onClick={e => e.stopPropagation()}>
        {title && <div className="text-lg font-medium mb-3">{title}</div>}
        <div className="overflow-auto scroll-area">{children}</div>
        {footer && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

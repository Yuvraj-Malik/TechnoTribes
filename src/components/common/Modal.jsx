// Accessible dialog built on <dialog>: traps focus, closes on Esc and backdrop click.
import { useEffect, useRef } from 'react';
import Icon from './Icon';
import { focusRing } from './styles';

export default function Modal({ open, onClose, title, description, children }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      aria-labelledby="modal-title"
      className="m-auto w-[calc(100%-32px)] max-w-[440px] rounded-2xl border border-line bg-bg p-0 text-ink shadow-[0_24px_60px_-20px_rgba(0,0,0,0.45)] backdrop:bg-[rgba(8,20,13,0.55)] backdrop:backdrop-blur-[2px]"
    >
      {open && (
        <div className="p-6 sm:p-7">
          <div className="mb-1.5 flex items-start justify-between gap-4">
            <h2 id="modal-title" className="m-0 font-display text-[22px] leading-tight font-bold tracking-[-0.02em]">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className={`-mt-2 -mr-2 grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-dim hover:bg-surface ${focusRing}`}
            >
              <Icon name="close" size={18} />
            </button>
          </div>
          {description && <p className="m-0 mb-5 text-[15px] text-dim">{description}</p>}
          {children}
        </div>
      )}
    </dialog>
  );
}

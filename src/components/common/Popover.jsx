// Button + dropdown panel. Closes on outside click, Esc (focus returns to the button) and route change.
import { useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

export default function Popover({ button, label, children, panelClassName = '' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const id = useId();
  const location = useLocation();

  useEffect(() => { setOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => {
      if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={rootRef} className="relative">
      {button({
        ref: buttonRef,
        onClick: () => setOpen((o) => !o),
        'aria-expanded': open,
        'aria-controls': id,
        'aria-haspopup': 'true',
        'aria-label': label,
      })}
      {open && (
        <div
          id={id}
          className={`absolute top-[calc(100%+8px)] right-0 z-30 overflow-hidden rounded-xl border border-line bg-surface shadow-[0_18px_44px_-16px_rgba(0,0,0,0.35)] ${panelClassName}`}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}

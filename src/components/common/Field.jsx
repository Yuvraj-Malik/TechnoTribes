// Labeled text input with optional hint, error message and show/hide for passwords.
import { forwardRef, useId, useState } from 'react';
import { focusRing } from './styles';

const Field = forwardRef(function Field(
  { label, error, hint, type = 'text', className = '', ...inputProps },
  ref,
) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const isPassword = type === 'password';
  const describedBy = [error && `${id}-err`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`mb-3.5 ${className}`}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">{label}</label>
      <div className="relative">
        <input
          ref={ref}
          id={id}
          type={isPassword && visible ? 'text' : type}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
          className={`w-full rounded-lg border-[1.5px] border-line bg-surface px-3.5 py-3 font-sans text-base text-ink aria-invalid:border-err ${isPassword ? 'pr-16' : ''} ${focusRing}`}
          {...inputProps}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            className={`absolute top-1/2 right-1 min-h-11 min-w-11 -translate-y-1/2 cursor-pointer rounded-md border-0 bg-transparent px-2.5 text-[13px] font-semibold text-accent ${focusRing}`}
          >
            {visible ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      {hint && <div id={`${id}-hint`} className="mt-[5px] text-[13px] text-dim">{hint}</div>}
      {error && <div id={`${id}-err`} className="mt-[5px] text-[13px] text-err">{error}</div>}
    </div>
  );
});

export default Field;

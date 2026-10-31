// Labeled multi-line input that matches Field.
import { useId } from 'react';
import { focusRing } from './styles';

export default function TextArea({ label, hint, rows = 3, className = '', ...props }) {
  const id = useId();
  return (
    <div className={`mb-3.5 ${className}`}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">{label}</label>
      <textarea
        id={id}
        rows={rows}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={`block w-full resize-y rounded-lg border-[1.5px] border-line bg-surface px-3.5 py-3 font-sans text-base text-ink ${focusRing}`}
        {...props}
      />
      {hint && <div id={`${id}-hint`} className="mt-[5px] text-[13px] text-dim">{hint}</div>}
    </div>
  );
}

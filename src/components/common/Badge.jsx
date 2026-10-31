const TONES = {
  neutral: 'border-line text-dim',
  accent: 'border-accent text-accent',
  warn: 'border-mark text-ink',
  err: 'border-err text-err',
};

export default function Badge({ tone = 'neutral', children }) {
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[13px] whitespace-nowrap ${TONES[tone]}`}>
      {children}
    </span>
  );
}

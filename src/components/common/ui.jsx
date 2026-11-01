// Small building blocks for the team workspace, in the app's theme tokens.
import { focusRing } from './styles';

export const cx = (...c) => c.filter(Boolean).join(' ');

const TONES = {
  slate: 'bg-bg text-dim ring-line',
  blue: 'bg-pip-b/10 text-pip-b ring-pip-b/30',
  green: 'bg-ok/10 text-ok ring-ok/30',
  amber: 'bg-mark/15 text-ink ring-mark/50',
  red: 'bg-err/10 text-err ring-err/30',
  violet: 'bg-accent/10 text-accent ring-accent/30',
  teal: 'bg-pip-ok/10 text-pip-ok ring-pip-ok/30',
};

export function Badge({ tone = 'slate', children, className, title }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', TONES[tone], className)}>
      {children}
    </span>
  );
}

const VARIANTS = {
  primary: 'bg-accent text-accent-ink hover:brightness-110',
  secondary: 'bg-surface text-ink ring-1 ring-inset ring-line hover:bg-bg',
  ghost: 'text-dim hover:bg-bg hover:text-ink',
  danger: 'bg-err text-white hover:brightness-110',
  success: 'bg-ok text-white hover:brightness-110',
  warning: 'bg-mark text-ink hover:brightness-105',
};

export function Button({ variant = 'primary', size = 'md', className, type = 'button', ...rest }) {
  return (
    <button
      type={type}
      {...rest}
      className={cx(
        'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border-0 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm',
        VARIANTS[variant], focusRing, className,
      )}
    />
  );
}

const CARD_TONES = {
  amber: 'border-mark bg-mark/10',
  red: 'border-err bg-err/5',
  blue: 'border-accent/40 bg-accent/5',
  green: 'border-ok/50 bg-ok/5',
};

export function Card({ children, className, tone }) {
  return <div className={cx('rounded-xl border p-4', CARD_TONES[tone] ?? 'border-line bg-surface', className)}>{children}</div>;
}

const PALETTE = ['#7c3aed', '#2563eb', '#db2777', '#0f766e', '#ea580c', '#65a30d', '#b45309', '#0891b2'];
export const colorFor = (id = '') => PALETTE[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % PALETTE.length];

export function Avatar({ person, size = 24 }) {
  if (!person) return null;
  return (
    <span
      title={person.name}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: colorFor(person.id), fontSize: size * 0.42 }}
    >
      {person.name[0]}
    </span>
  );
}

export function PanelTitle({ children, right }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="m-0 text-xs font-semibold uppercase tracking-wide text-dim">{children}</h2>
      {right}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-dim">{children}</div>;
}

export function SimulatedTag({ children = 'Simulated' }) {
  return <Badge tone="amber" title="This part is simulated for the demo">⚙ {children}</Badge>;
}

export const textareaClass = `w-full rounded-lg border border-line bg-surface p-2 text-sm text-ink ${focusRing}`;

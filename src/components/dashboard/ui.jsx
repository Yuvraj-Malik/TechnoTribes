// Small building blocks shared by the dashboard pages.
import { Link } from 'react-router-dom';
import Icon from '../common/Icon';
import { focusRing } from '../common/styles';
import { ROLE_LABEL } from '../../utils/format';

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-7 flex flex-col gap-4 sm:mb-8 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h1 className="m-0 font-display text-[26px] leading-[1.15] font-bold tracking-[-0.02em] sm:text-[32px]">{title}</h1>
        {description && <p className="m-0 mt-1.5 max-w-[60ch] text-dim">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2.5">{actions}</div>}
    </div>
  );
}

export function SectionHeader({ title, to, linkLabel = 'View all' }) {
  return (
    <div className="mb-3.5 flex items-center justify-between gap-3">
      <h2 className="m-0 text-lg font-semibold">{title}</h2>
      {to && (
        <Link to={to} className={`inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent no-underline hover:underline ${focusRing}`}>
          {linkLabel} <Icon name="arrowRight" size={16} />
        </Link>
      )}
    </div>
  );
}

const buttonBase = `inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[10px] px-4 text-[15px] font-semibold no-underline disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;
export const buttonPrimary = `${buttonBase} border-0 bg-accent text-accent-ink hover:brightness-110`;
export const buttonSecondary = `${buttonBase} border-[1.5px] border-line bg-surface text-ink hover:border-dim`;

export function RoleBadge({ role, pending }) {
  const tone = {
    owner: 'border-mark/60 text-ink',
    admin: 'border-accent/50 text-accent',
    worker: 'border-line text-dim',
    observer: 'border-line text-dim',
  }[role] || 'border-line text-dim';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${tone}`}>
      {role === 'owner' && <i className="inline-block size-1.5 rotate-45 bg-mark" aria-hidden="true" />}
      {ROLE_LABEL[role] || role}{pending ? ' · Pending' : ''}
    </span>
  );
}

export function StatTile({ label, value, icon, hint }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3 sm:p-5">
      <div className="flex items-start justify-between gap-2 text-dim">
        <span className="text-xs leading-tight font-medium sm:text-sm">{label}</span>
        <Icon name={icon} size={18} className="hidden sm:block" />
      </div>
      <p className="m-0 mt-2 font-display text-[26px] leading-none font-bold tracking-[-0.02em] sm:text-[32px]">{value}</p>
      {hint && <p className="m-0 mt-2 text-[13px] text-dim">{hint}</p>}
    </div>
  );
}

export function EmptyState({ icon, title, text, children }) {
  return (
    <div className="flex flex-col items-center rounded-xl border-[1.5px] border-dashed border-line bg-surface/50 px-6 py-12 text-center">
      <span className="mb-4 grid size-12 place-items-center rounded-full bg-accent/10 text-accent">
        <Icon name={icon} size={22} />
      </span>
      <p className="m-0 text-lg font-semibold">{title}</p>
      {text && <p className="m-0 mt-1.5 max-w-[46ch] text-dim">{text}</p>}
      {children && <div className="mt-5 flex flex-wrap justify-center gap-2.5">{children}</div>}
    </div>
  );
}

export function CardSkeleton({ count = 3 }) {
  return Array.from({ length: count }, (_, i) => (
    <div key={i} className="h-[178px] animate-pulse rounded-xl border border-line bg-surface" aria-hidden="true" />
  ));
}

export function ProjectMark({ name }) {
  return (
    <span className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-panel font-display text-lg font-bold text-mark" aria-hidden="true">
      {(name || '?').trim()[0]?.toUpperCase()}
    </span>
  );
}

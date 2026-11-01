// Shared bits for the project pages (/projects/:projectId/*).
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../services/apiClient';
import { useTeam } from '../../context/TeamContext';
import { cx } from '../../components/common/ui';
import { focusRing } from '../../components/common/styles';

/** Page frame with a consistent width and padding. */
export function Page({ children, wide }) {
  return <div className={cx('mx-auto w-full px-4 py-6 sm:px-6 sm:py-8 lg:px-8', wide ? 'max-w-7xl' : 'max-w-5xl')}>{children}</div>;
}

/**
 * Loads data and keeps it fresh with the team's polling tick, without
 * flashing a loading state on every refresh. load() returns a promise.
 */
export function useLive(load, deps = []) {
  const { tick } = useTeam();
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const first = useRef(true);
  const run = useCallback(() => load()
    .then((data) => setState({ data, error: '', loading: false }))
    .catch((e) => setState((s) => ({ data: s.data, error: e.message, loading: false }))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  deps);
  useEffect(() => { first.current = true; setState((s) => ({ ...s, loading: true })); run(); }, [run]);
  useEffect(() => { if (first.current) { first.current = false; return; } run(); }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload: run };
}

/** Non-team API call with projectId filled in. */
export function useProjectApi() {
  const { projectId } = useTeam();
  return {
    get: (path, query = {}) => api(path, { query: { projectId, ...query } }),
    post: (path, body = {}) => api(path, { method: 'POST', body: { projectId, ...body } }),
  };
}

/** Runs an action with busy/error/ok state. */
export function useAction() {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const run = async (key, fn, success) => {
    setBusy(key); setError(''); setOk('');
    try { const r = await fn(); if (success) setOk(success); return r ?? true; } catch (e) { setError(e.message); return null; } finally { setBusy(''); }
  };
  return { busy, error, ok, run, setError, setOk };
}

export function Notice({ error, ok }) {
  if (!error && !ok) return null;
  return (
    <div role={error ? 'alert' : 'status'} className={cx('mb-4 rounded-lg px-3 py-2 text-sm', error ? 'bg-err/10 text-err' : 'bg-ok/10 text-ok')}>
      {error || ok}
    </div>
  );
}

export const inputClass = `min-h-11 w-full rounded-lg border-[1.5px] border-line bg-surface px-3 text-[15px] text-ink placeholder:text-dim/70 ${focusRing}`;
export const selectClass = `min-h-11 rounded-lg border-[1.5px] border-line bg-surface px-3 text-[15px] text-ink ${focusRing}`;
export const areaClass = `w-full rounded-lg border-[1.5px] border-line bg-surface p-3 text-[15px] leading-relaxed text-ink placeholder:text-dim/70 ${focusRing}`;

export function Section({ title, description, right, children, className }) {
  return (
    <section className={cx('rounded-xl border border-line bg-surface p-4 sm:p-5', className)}>
      {(title || right) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="m-0 text-base font-semibold text-ink sm:text-lg">{title}</h2>}
            {description && <p className="m-0 mt-1 text-sm text-dim">{description}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Loading({ label = 'Loading…' }) {
  return <div className="py-12 text-center text-dim" role="status">{label}</div>;
}

export const TASK_STATUS = {
  open: { label: 'Not started', tone: 'slate' },
  in_progress: { label: 'In progress', tone: 'blue' },
  in_review: { label: 'In review', tone: 'amber' },
  done: { label: 'Done', tone: 'green' },
};

export const REQUEST_STATUS = {
  pending: { label: 'Waiting', tone: 'amber' },
  accepted: { label: 'Being worked on', tone: 'blue' },
  done: { label: 'Done', tone: 'green' },
  rejected: { label: 'Declined', tone: 'red' },
};

export const SUBMISSION_STATUS = {
  pending: { label: 'Waiting for review', tone: 'amber' },
  merge_conflict: { label: 'Merge conflict', tone: 'red' },
  approved: { label: 'Approved & merged', tone: 'green' },
  sent_back: { label: 'Sent back', tone: 'violet' },
  rejected: { label: 'Rejected', tone: 'red' },
};

export function Copyable({ value, label }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
      className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border-[1.5px] border-dashed border-line bg-bg px-3 font-mono text-[15px] font-semibold tracking-wide text-ink hover:border-accent ${focusRing}`}
      aria-label={`Copy ${label}`}
    >
      {value}
      <span className="font-sans text-xs font-medium text-dim">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

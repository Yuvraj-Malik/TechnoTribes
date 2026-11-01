// The observer's two pages, in plain language:
//   Updates   what changed, what is happening now, what comes next
//   Live site the approved version of the product, running in the browser
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTeam } from '../../context/TeamContext';
import { Badge, cx } from '../../components/common/ui';
import { EmptyState } from '../../components/dashboard/ui';
import { buildPreview } from '../../components/preview/WorkArea';
import { timeAgo } from '../../utils/time';
import { Loading, Notice, Page, useLive, useProjectApi } from '../projects/shared';

function useFeed() {
  const api = useProjectApi();
  return useLive(() => api.get('observer/feed'), []);
}

const LANES = [
  { stage: 'done', title: 'Done', hint: 'Finished, approved and live', dot: 'bg-ok', ring: 'border-ok/40', head: 'text-ok' },
  { stage: 'now', title: 'Happening now', hint: 'Being built or checked', dot: 'bg-mark', ring: 'border-mark', head: 'text-ink' },
  { stage: 'upcoming', title: 'Coming up', hint: 'Planned next', dot: 'bg-line', ring: 'border-line', head: 'text-dim' },
];

function ProgressRing({ done, total }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const r = 52; const c = 2 * Math.PI * r;
  return (
    <div className="relative size-[132px] shrink-0" role="img" aria-label={`${pct}% of tasks done`}>
      <svg viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="12" className="stroke-line" />
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="12" strokeLinecap="round" className="stroke-ok transition-[stroke-dashoffset] duration-700"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <span className="font-display text-[32px] leading-none font-bold">{pct}%</span>
        <span className="mt-1 text-xs text-dim">done</span>
      </div>
    </div>
  );
}

function WhatWhy({ what, why }) {
  if (!what && !why) return null;
  return (
    <div className="mt-3 grid gap-2 text-sm">
      {what && (
        <div className="rounded-lg bg-ok/8 px-3 py-2">
          <p className="m-0 text-[11px] font-bold tracking-wide text-ok uppercase">What changed</p>
          <p className="m-0 mt-0.5 text-ink">{what}</p>
        </div>
      )}
      {why && (
        <div className="rounded-lg bg-mark/12 px-3 py-2">
          <p className="m-0 text-[11px] font-bold tracking-wide text-ink/70 uppercase">Why</p>
          <p className="m-0 mt-0.5 text-ink">{why}</p>
        </div>
      )}
    </div>
  );
}

function TaskCard({ t, lane }) {
  return (
    <li className={cx('rounded-xl border-[1.5px] bg-surface p-4', lane.ring)}>
      <div className="flex items-start gap-2">
        <span className={cx('mt-1.5 size-2.5 shrink-0 rounded-full', lane.dot, lane.stage === 'now' && 'animate-pulse')} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="m-0 font-semibold text-ink">{t.title}</p>
          <p className="m-0 mt-0.5 text-sm text-dim">{t.statusWords} · {t.who}</p>
          {(t.fromYourRequest || t.fromRequest) && <Badge tone="violet" className="mt-2">{t.fromYourRequest ? 'You asked for this' : 'From an observer request'}</Badge>}
        </div>
      </div>
      {lane.stage !== 'upcoming' ? <WhatWhy what={t.what} why={t.why} /> : t.details && <p className="m-0 mt-2 text-sm text-dim">{t.details}</p>}
    </li>
  );
}

const REQ_STEPS = ['Asked', 'Accepted', 'Being built', 'Done'];
function requestStep(r) {
  if (r.status === 'rejected') return -1;
  if (r.status === 'done' || r.taskStatus === 'done') return 3;
  if (r.taskStatus === 'in_progress' || r.taskStatus === 'in_review') return 2;
  if (r.status === 'accepted') return 1;
  return 0;
}

function RequestTracker({ r }) {
  const step = requestStep(r);
  return (
    <li className="rounded-xl border border-line bg-surface p-4">
      <p className="m-0 text-ink">“{r.message}”</p>
      <p className="m-0 mt-1 text-xs text-dim">Asked {timeAgo(r.created_at)}{r.assignee ? ` · ${r.assignee} is on it` : ''}</p>
      {step < 0 ? (
        <p className="m-0 mt-3 rounded-lg bg-err/10 px-3 py-2 text-sm text-err">Declined{r.response ? `: ${r.response}` : ''}</p>
      ) : (
        <ol className="m-0 mt-3 flex list-none items-center gap-1 p-0" aria-label={`Status: ${REQ_STEPS[step]}`}>
          {REQ_STEPS.map((label, i) => (
            <li key={label} className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
              <span className={cx('h-1.5 w-full rounded-full', i <= step ? 'bg-ok' : 'bg-line')} />
              <span className={cx('text-[11px] leading-tight', i === step ? 'font-bold text-ink' : i < step ? 'text-ok' : 'text-dim')}>{label}</span>
            </li>
          ))}
        </ol>
      )}
      {r.response && step >= 0 && <p className="m-0 mt-2 text-sm text-dim">{r.response}</p>}
    </li>
  );
}

export function ObserverUpdates() {
  const { projectId } = useTeam();
  const { data, loading, error } = useFeed();
  if (loading && !data) return <Page><Loading /></Page>;
  if (!data) return <Page><Notice error={error} /></Page>;
  const base = `/projects/${projectId}`;
  const total = data.roadmap.length;
  const byStage = (st) => data.roadmap.filter((t) => t.stage === st);
  const now = byStage('now');

  return (
    <Page wide>
      {/* Where things stand */}
      <section className="mb-6 overflow-hidden rounded-2xl bg-panel text-panel-ink">
        <div className="flex flex-col gap-6 p-6 sm:p-8 md:flex-row md:items-center">
          <div className="min-w-0 flex-1">
            <p className="m-0 text-xs font-semibold tracking-[0.12em] text-panel-dim uppercase">Project update</p>
            <h1 className="m-0 mt-1 font-display text-[28px] leading-tight font-bold sm:text-[36px]">{data.project.name}</h1>
            <p className="m-0 mt-2 max-w-[60ch] text-panel-dim">
              {total
                ? `${data.counts.done} of ${total} pieces of work are finished. ${now.length ? `${now.length} ${now.length === 1 ? 'is' : 'are'} being worked on right now.` : 'Nothing is being worked on this minute.'}`
                : 'The team has not planned any work yet.'}
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <Link to={`${base}/site`} className="inline-flex min-h-11 items-center rounded-[10px] bg-mark px-4 font-semibold text-[#2a1d00] no-underline hover:brightness-105">See the live site</Link>
              {data.isObserver && <Link to={`${base}/requests`} className="inline-flex min-h-11 items-center rounded-[10px] border-[1.5px] border-panel-dim/50 px-4 font-semibold text-panel-ink no-underline hover:border-panel-ink">Ask for a change</Link>}
            </div>
          </div>
          <div className="flex items-center gap-5 rounded-2xl bg-surface p-4 text-ink">
            <ProgressRing done={data.counts.done} total={total} />
            <ul className="m-0 list-none space-y-2 p-0 text-sm">
              {LANES.map((l) => (
                <li key={l.stage} className="flex items-center gap-2">
                  <span className={cx('size-2.5 rounded-full', l.dot)} aria-hidden="true" />
                  <span className="font-display text-lg font-bold">{data.counts[l.stage]}</span>
                  <span className="text-dim">{l.title.toLowerCase()}</span>
                </li>
              ))}
              <li className="pt-1 text-xs text-dim">Live site: version {data.version}</li>
            </ul>
          </div>
        </div>
      </section>
      <Notice error={error} />

      {/* The work, in three lanes */}
      <h2 className="m-0 mb-3 text-lg font-semibold">The work</h2>
      <div className="mb-8 grid gap-4 lg:grid-cols-3">
        {LANES.map((lane) => {
          const items = byStage(lane.stage);
          return (
            <section key={lane.stage} className="rounded-2xl bg-bg/60 p-3 ring-1 ring-line" aria-label={lane.title}>
              <div className="mb-3 flex items-baseline justify-between px-1">
                <h3 className={cx('m-0 text-base font-bold', lane.head)}>{lane.title} <span className="font-normal text-dim">({items.length})</span></h3>
                <span className="text-xs text-dim">{lane.hint}</span>
              </div>
              {items.length ? (
                <ul className="m-0 list-none space-y-3 p-0">{items.map((t) => <TaskCard key={t.id} t={t} lane={lane} />)}</ul>
              ) : <p className="m-0 px-1 py-6 text-center text-sm text-dim">Nothing here.</p>}
            </section>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Every change with what and why */}
        <section>
          <h2 className="m-0 mb-3 text-lg font-semibold">Every change, and why</h2>
          {data.changes.length === 0 ? <p className="m-0 text-sm text-dim">No changes yet.</p> : (
            <ol className="m-0 list-none space-y-3 border-l-2 border-line p-0 pl-5">
              {data.changes.map((c) => (
                <li key={c.id} className="relative rounded-xl border border-line bg-surface p-4">
                  <span className={cx('absolute top-5 -left-[27px] size-3 rounded-full ring-4 ring-bg', c.kind === 'product' ? 'bg-ok' : 'bg-mark')} aria-hidden="true" />
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={c.kind === 'product' ? 'green' : 'amber'}>{c.kind === 'product' ? 'Product change' : 'Plan or rule change'}</Badge>
                    <span className="text-xs text-dim">{c.who} · {timeAgo(c.when)}</span>
                  </div>
                  <p className="m-0 mt-2 font-semibold text-ink">{c.title}</p>
                  <WhatWhy what={c.what !== c.title ? c.what : null} why={c.why ?? 'No reason was written for this one.'} />
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Your requests */}
        {data.isObserver && (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="m-0 text-lg font-semibold">Your requests</h2>
              <Link to={`${base}/requests`} className="text-sm font-semibold text-accent no-underline hover:underline">Ask for a change</Link>
            </div>
            {data.myRequests.length ? (
              <ul className="m-0 list-none space-y-3 p-0">{data.myRequests.map((r) => <RequestTracker key={r.id} r={r} />)}</ul>
            ) : (
              <EmptyState icon="inbox" title="No requests yet" text="Ask for a change in your own words. You will see it move from asked to done here." />
            )}
          </section>
        )}
      </div>
    </Page>
  );
}

export function ObserverSite() {
  const { data, loading, error } = useFeed();
  const files = data?.currentSite?.files ?? {};
  const pages = useMemo(() => Object.keys(files).filter((p) => /\.html?$/i.test(p)).map((p) => p.slice(4)).sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b))), [files]);
  const [page, setPage] = useState('');
  const current = page && pages.includes(page) ? page : pages[0];
  if (loading && !data) return <Page><Loading /></Page>;
  return (
    <div className="flex h-full min-h-[calc(100dvh-8rem)] flex-col px-4 py-4 sm:px-6 lg:px-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 font-display text-2xl font-bold tracking-[-0.02em]">Live site</h1>
          <p className="m-0 text-sm text-dim">The approved version{data ? ` (v${data.version})` : ''}. Work in progress is not shown until a manager approves it.</p>
        </div>
        {pages.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Pages">
            {pages.map((p) => (
              <button key={p} type="button" role="tab" aria-selected={p === current} onClick={() => setPage(p)}
                className={cx('min-h-11 cursor-pointer rounded-full border-[1.5px] px-3.5 font-mono text-xs font-semibold', p === current ? 'border-accent bg-accent/10 text-accent' : 'border-line bg-surface text-dim')}>
                {p}
              </button>
            ))}
          </div>
        )}
      </div>
      <Notice error={error} />
      {current ? (
        <div className="flex min-h-[480px] flex-1 flex-col overflow-hidden rounded-xl border border-line bg-white shadow-sm">
          <div className="flex items-center gap-1.5 border-b border-line bg-bg px-3 py-2" aria-hidden="true">
            <span className="size-2.5 rounded-full bg-err/60" /><span className="size-2.5 rounded-full bg-mark" /><span className="size-2.5 rounded-full bg-ok/60" />
            <span className="ml-2 truncate font-mono text-xs text-dim">{current}</span>
          </div>
          <iframe title="Live site" sandbox="allow-scripts" className="min-h-0 w-full flex-1 border-0 bg-white" srcDoc={buildPreview(files, current)} />
        </div>
      ) : <EmptyState icon="compass" title="Nothing to show yet" text="The site appears here after the first approved change." />}
    </div>
  );
}

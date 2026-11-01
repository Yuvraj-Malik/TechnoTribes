// The observer's two pages, in plain language:
//   Updates   how much is done, by whom, how much is left, and what happens next
//   Live site the approved version of the product, running in the browser
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTeam } from '../../context/TeamContext';
import { Badge, cx } from '../../components/common/ui';
import { EmptyState } from '../../components/dashboard/ui';
import { focusRing } from '../../components/common/styles';
import { buildPreview } from '../../components/preview/WorkArea';
import WorkWall from '../../components/coordination/WorkWall';
import WhoIsDoingWhat from '../../components/coordination/WhoIsDoingWhat';
import PlainUpdate from '../../components/timeline/PlainUpdate';
import ProjectLine from '../../components/timeline/ProjectLine';
import WhatWhy from '../../components/timeline/WhatWhy';
import ProductMap from '../../components/dependency-graph/ProductMap';
import { headline } from '../../features/observer/progressModel';
import { timeAgo } from '../../utils/time';
import { Loading, Notice, Page, Section, useLive, useProjectApi } from '../projects/shared';

function useFeed() {
  const api = useProjectApi();
  return useLive(() => api.get('observer/feed'), []);
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
      <p className="m-0 mt-1 text-xs text-dim">Asked {timeAgo(r.created_at)}{step === 0 ? ' · Waiting for a decision' : r.assignee && step < 3 ? ` · ${r.assignee} is on it` : ''}</p>
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

const FIT_VIEWS = [['line', 'Project line'], ['map', 'Product map']];

// How the work fits together: the branch graph and the code graph, in plain words.
function HowItFits({ line, map }) {
  const [view, setView] = useState(FIT_VIEWS[0][0]);
  const hasMap = map.parts.length > 0;
  return (
    <Section
      className="mb-6"
      title="How the work fits together"
      description={view === 'line' ? 'The green line is what customers can see today. New work is built on side tracks and joins the line only when a person approves it.' : 'Every part of the site and what relies on what. Pick a part to see what a change would touch.'}
      right={hasMap && (
        <div className="flex gap-2" role="tablist" aria-label="Ways to see the work">
          {FIT_VIEWS.map(([key, label]) => (
            <button
              key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)}
              className={cx('min-h-11 cursor-pointer rounded-full border-[1.5px] px-4 text-sm font-semibold', view === key ? 'border-accent bg-accent/10 text-accent' : 'border-line bg-surface text-dim', focusRing)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    >
      {view === 'line' ? <ProjectLine line={line} /> : <ProductMap map={map} />}
    </Section>
  );
}

export function ObserverUpdates() {
  const { projectId } = useTeam();
  const { data, loading, error } = useFeed();
  if (loading && !data) return <Page><Loading /></Page>;
  if (!data) return <Page><Notice error={error} /></Page>;
  const base = `/projects/${projectId}`;
  const answer = headline(data.counts);

  return (
    <Page wide>
      {/* The answer first, then the wall */}
      <section className="mb-6 overflow-hidden rounded-2xl bg-panel text-panel-ink">
        <div className="flex flex-col gap-6 p-5 sm:p-8 xl:flex-row xl:items-center">
          <div className="min-w-0 xl:w-[36%] xl:shrink-0">
            <p className="m-0 text-xs font-semibold tracking-[0.12em] text-panel-dim uppercase">Project update</p>
            <h1 className="m-0 mt-1 font-display text-[28px] leading-tight font-bold tracking-[-0.02em] sm:text-[38px]">
              {answer ? <><span className="text-mark">{answer.lead}</span> {answer.rest}</> : data.project.name}
            </h1>
            <p className="m-0 mt-2.5 max-w-[60ch] text-panel-dim">{answer ? answer.detail : 'The team has not planned any work yet.'}</p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <Link to={`${base}/site`} className="inline-flex min-h-11 items-center rounded-[10px] bg-mark px-4 font-semibold text-[#2a1d00] no-underline hover:brightness-105">See the live site</Link>
              {data.isObserver && <Link to={`${base}/requests`} className="inline-flex min-h-11 items-center rounded-[10px] border-[1.5px] border-panel-dim/50 px-4 font-semibold text-panel-ink no-underline hover:border-panel-ink">Ask for a change</Link>}
            </div>
          </div>
          {answer && (
            <div className="min-w-0 flex-1 rounded-2xl bg-surface p-3 text-ink sm:p-4">
              <WorkWall work={data.roadmap} counts={data.counts} />
            </div>
          )}
        </div>
      </section>
      <Notice error={error} />

      {answer && (
        <>
          <Section className="mb-6" title="The last 24 hours, in plain words"><PlainUpdate update={data.update} forInvestor={data.isObserver} /></Section>
          <Section className="mb-6" title="Who is doing what" description="Everyone builds with their own AI agent. A person checks every result."><WhoIsDoingWhat people={data.people} /></Section>
          <HowItFits line={data.line} map={data.map} />
        </>
      )}

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

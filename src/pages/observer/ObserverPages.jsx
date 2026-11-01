// The observer's two pages, in plain language:
//   Updates   what changed, what is happening now, what comes next
//   Live site the approved version of the product, running in the browser
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTeam } from '../../context/TeamContext';
import { Badge, cx } from '../../components/common/ui';
import { EmptyState, PageHeader, StatTile, buttonPrimary, buttonSecondary } from '../../components/dashboard/ui';
import { buildPreview } from '../../components/preview/WorkArea';
import { timeAgo } from '../../utils/time';
import { Loading, Notice, Page, Section, useLive, useProjectApi } from '../projects/shared';

function useFeed() {
  const api = useProjectApi();
  return useLive(() => api.get('observer/feed'), []);
}

export function ObserverUpdates() {
  const { projectId, me } = useTeam();
  const { data, loading, error } = useFeed();
  if (loading && !data) return <Page><Loading /></Page>;
  if (!data) return <Page><Notice error={error} /></Page>;
  const base = `/projects/${projectId}`;
  const openRequests = (data.myRequests ?? []).filter((r) => ['pending', 'accepted'].includes(r.status)).length;
  return (
    <Page wide>
      <PageHeader
        title={data.project.name}
        description={data.project.description || 'What the team is building, in plain words.'}
        actions={[
          <Link key="s" to={`${base}/site`} className={buttonPrimary}>See the live site</Link>,
          me.role === 'observer' && <Link key="r" to={`${base}/requests`} className={buttonSecondary}>Ask for a change</Link>,
        ].filter(Boolean)}
      />
      <Notice error={error} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Approved versions" value={data.version} icon="book" />
        <StatTile label="Being worked on" value={data.happeningNow.length} icon="code" />
        <StatTile label="Coming next" value={data.nextSteps.length} icon="clock" />
        {me.role === 'observer' && <StatTile label="Your open requests" value={openRequests} icon="inbox" />}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Section title="What changed" description="Approved changes and updated requirements, newest first.">
          {data.whatChanged.length === 0 ? <p className="m-0 text-sm text-dim">No approved changes yet.</p> : (
            <ol className="m-0 list-none space-y-4 border-l-2 border-line p-0 pl-4">
              {data.whatChanged.map((c) => (
                <li key={c.id} className="relative">
                  <span className={cx('absolute top-1.5 -left-[21px] size-2.5 rounded-full', c.kind === 'change' ? 'bg-ok' : c.kind === 'requirement' ? 'bg-mark' : 'bg-accent')} aria-hidden="true" />
                  <p className="m-0 text-ink">{c.text}</p>
                  <p className="m-0 mt-0.5 flex items-center gap-2 text-xs text-dim">
                    <Badge tone={c.kind === 'change' ? 'green' : c.kind === 'requirement' ? 'amber' : 'slate'}>
                      {c.kind === 'change' ? 'Product change' : c.kind === 'requirement' ? 'Requirement' : 'Project'}
                    </Badge>
                    {timeAgo(c.when)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Section>
        <div className="space-y-5">
          <Section title="Happening now">
            {data.happeningNow.length === 0 ? <p className="m-0 text-sm text-dim">Nobody is working on anything right now.</p> : (
              <ul className="m-0 list-disc space-y-2 pl-5 text-sm text-ink">{data.happeningNow.map((t) => <li key={t}>{t}</li>)}</ul>
            )}
          </Section>
          <Section title="Coming next">
            {data.nextSteps.length === 0 ? <p className="m-0 text-sm text-dim">Nothing planned yet.</p> : (
              <ul className="m-0 list-disc space-y-2 pl-5 text-sm text-ink">{data.nextSteps.map((t) => <li key={t}>{t}</li>)}</ul>
            )}
          </Section>
        </div>
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

// A developer's submissions: what they sent for review, the manager's answer,
// and whether the context changed underneath a pending one.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTeam } from '../../context/TeamContext';
import { Badge, Button } from '../../components/common/ui';
import { EmptyState, PageHeader, buttonPrimary } from '../../components/dashboard/ui';
import DiffViewer from '../../components/reviews/DiffViewer';
import { timeAgo } from '../../utils/time';
import { Loading, Notice, Page, SUBMISSION_STATUS, useLive } from '../projects/shared';

function Submission({ s }) {
  const [open, setOpen] = useState(false);
  const st = SUBMISSION_STATUS[s.status] ?? { label: s.status, tone: 'slate' };
  return (
    <li className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 font-semibold text-ink">{s.title}</p>
          <p className="m-0 mt-0.5 text-xs text-dim">{timeAgo(s.createdAt)} · {s.files?.length ?? 0} file{s.files?.length === 1 ? '' : 's'}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={st.tone}>{st.label}</Badge>
          {s.outdated?.length > 0 && <Badge tone="red">Outdated</Badge>}
        </div>
      </div>
      {s.summary && <p className="m-0 mt-2 text-sm text-ink">{s.summary}</p>}
      {s.why && <p className="m-0 mt-1 text-sm text-dim">Why: {s.why}</p>}
      {s.outdated?.length > 0 && (
        <p className="m-0 mt-2 rounded-lg bg-err/10 px-3 py-2 text-sm text-err">
          Built on an older context: {s.outdated.map((o) => o.title).join(', ')} changed since.
        </p>
      )}
      {s.reviewNote && (
        <p className="m-0 mt-2 rounded-lg bg-accent/5 px-3 py-2 text-sm text-ink"><strong>Manager:</strong> {s.reviewNote}</p>
      )}
      {s.mergeInfo?.conflicted?.length > 0 && (
        <p className="m-0 mt-2 text-sm text-err">Merge conflict in {s.mergeInfo.conflicted.join(', ')}.</p>
      )}
      <Button variant="ghost" className="mt-2 min-h-11 !px-0" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? 'Hide changes' : 'Show changes'}
      </Button>
      {open && <div className="mt-2"><DiffViewer diff={s.diff} /></div>}
    </li>
  );
}

export default function MySubmissions() {
  const { get, me, projectId } = useTeam();
  const { data, loading, error } = useLive(() => get('my/submissions'), [me.id]);
  const subs = data?.submissions ?? [];
  return (
    <Page>
      <PageHeader title="My submissions" description="Everything you sent for review, and what your manager decided." />
      <Notice error={error} />
      {loading && !data ? <Loading /> : subs.length === 0 ? (
        <EmptyState icon="review" title="Nothing submitted yet" text="When your agent finishes a task, submit it from your workspace and it shows up here.">
          <Link to={`/projects/${projectId}/workspace`} className={buttonPrimary}>Open my workspace</Link>
        </EmptyState>
      ) : (
        <ul className="m-0 list-none space-y-3 p-0">{subs.map((s) => <Submission key={s.id} s={s} />)}</ul>
      )}
    </Page>
  );
}

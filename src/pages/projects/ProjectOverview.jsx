// Project overview (owner, admin, worker): numbers, who is working on what
// (with the agents' overlap warnings), departments and recent activity.
import { Link } from 'react-router-dom';
import { useTeam } from '../../context/TeamContext';
import { Avatar, Badge, cx } from '../../components/common/ui';
import { PageHeader, StatTile, buttonPrimary, buttonSecondary } from '../../components/dashboard/ui';
import { timeAgo } from '../../utils/time';
import { Loading, Notice, Page, Section, useLive } from './shared';

const ROLE_WORD = { owner: 'Owner', admin: 'Manager', worker: 'Developer', observer: 'Observer' };

function Board({ board, me, deptById }) {
  if (!board.length) return <p className="m-0 text-sm text-dim">No developers yet. Add workers from Members.</p>;
  return (
    <ul className="m-0 grid list-none gap-3 p-0 @2xl:grid-cols-2">
      {board.map((b) => {
        const d = deptById(b.department);
        const t = b.task;
        return (
          <li key={b.userId} className={cx('rounded-xl border p-3.5', t?.peers?.length && t.active ? 'border-mark bg-mark/5' : 'border-line bg-bg/40')}>
            <div className="flex items-center gap-2.5">
              <Avatar person={{ id: b.userId, name: b.name }} size={30} />
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate font-semibold text-ink">{b.name}{b.userId === me.id ? ' (you)' : ''}</p>
                <p className="m-0 flex items-center gap-1.5 text-xs text-dim">
                  {d && <span className="size-2 rounded-full" style={{ background: d.color }} aria-hidden="true" />}
                  {d?.name ?? 'No department'}
                </p>
              </div>
              {t ? <Badge tone={t.active ? 'blue' : t.status === 'approved' ? 'green' : 'slate'}>{t.active ? 'Active' : t.status.replace('_', ' ')}</Badge> : <Badge>Idle</Badge>}
            </div>
            {t ? (
              <div className="mt-3 text-sm">
                <p className="m-0 font-medium text-ink">“{t.text}”</p>
                <p className="m-0 mt-1 text-dim">{t.statusWords} · {timeAgo(t.updatedAt)}</p>
                {t.files.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {t.files.slice(0, 5).map((f) => <span key={f} className="rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-dim ring-1 ring-line">{f}</span>)}
                    {t.files.length > 5 && <span className="text-[11px] text-dim">+{t.files.length - 5} more</span>}
                  </div>
                )}
                {t.active && t.peers?.length > 0 && (
                  <p className="m-0 mt-2 rounded-lg bg-mark/15 px-2.5 py-1.5 text-xs text-ink">
                    ⚠ Same files as {t.peers.map((p) => p.name).join(', ')}: the agents warned both of them.
                  </p>
                )}
                {t.outdated && <p className="m-0 mt-2 rounded-lg bg-err/10 px-2.5 py-1.5 text-xs text-err">Built on an older version of the context.</p>}
              </div>
            ) : <p className="m-0 mt-3 text-sm text-dim">No task yet.</p>}
          </li>
        );
      })}
    </ul>
  );
}

export default function ProjectOverview() {
  const { get, me, projectId, deptById, nameOf } = useTeam();
  const { data, error, loading } = useLive(() => get('overview'), [me.id]);
  const base = `/projects/${projectId}`;
  if (loading && !data) return <Page wide><Loading /></Page>;
  if (!data) return <Page wide><Notice error={error} /></Page>;
  const { project, stats, board, departments, recent, latestCommit } = data;
  const myDept = departments.find((d) => d.id === me.department);

  const actions = me.role === 'owner'
    ? [<Link key="r" to={`${base}/review`} className={buttonPrimary}>Review work</Link>, <Link key="m" to={`${base}/team`} className={buttonSecondary}>Members</Link>]
    : me.role === 'admin'
      ? [<Link key="r" to={`${base}/review`} className={buttonPrimary}>Review work</Link>, <Link key="t" to={`${base}/tasks`} className={buttonSecondary}>Assign a task</Link>]
      : [<Link key="w" to={`${base}/workspace`} className={buttonPrimary}>Open my workspace</Link>, <Link key="t" to={`${base}/tasks`} className={buttonSecondary}>My tasks</Link>];

  return (
    <Page wide>
      <div className="@container">
        <PageHeader
          title={project.name}
          description={project.description || `You are the ${ROLE_WORD[me.role].toLowerCase()}${myDept ? ` in ${myDept.name}` : ''}.`}
          actions={actions}
        />
        <Notice error={error} />

        <div className="mb-6 grid grid-cols-2 gap-3 @3xl:grid-cols-5">
          <StatTile label="Active agent work" value={stats.activeWork} icon="code" />
          <StatTile label={me.role === 'worker' ? 'Waiting for review' : 'To review'} value={stats.pendingReviews} icon="review" />
          <StatTile label={me.role === 'worker' ? 'My open tasks' : 'Open tasks'} value={stats.openTasks} icon="check" />
          <StatTile label="Approved merges" value={stats.merges} icon="book" />
          <StatTile label="Team members" value={stats.members} icon="users" />
        </div>

        <div className="grid gap-5 @5xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-5">
            <Section title="Who is working on what" description="Every developer's agent, live. Agents see this too, so they warn you before two people touch the same files.">
              <Board board={board} me={me} deptById={deptById} />
            </Section>
            <Section title="Recent activity" right={<Link to={`${base}/story`} className="text-sm font-semibold text-accent no-underline hover:underline">Full story</Link>}>
              {recent.length ? (
                <ol className="m-0 list-none space-y-3 p-0">
                  {recent.map((e) => (
                    <li key={e.id} className="flex gap-3 text-sm">
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent/60" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="m-0 text-ink">{e.summary}</p>
                        <p className="m-0 text-xs text-dim">{e.actorId ? nameOf(e.actorId) : 'System'} · {timeAgo(e.at)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : <p className="m-0 text-sm text-dim">Nothing yet.</p>}
            </Section>
          </div>

          <div className="space-y-5">
            {latestCommit && (
              <Section title="Latest approved change">
                <p className="m-0 font-medium text-ink">{latestCommit.message}</p>
                <p className="m-0 mt-1 text-sm text-dim">{latestCommit.by} · {timeAgo(latestCommit.at)}</p>
              </Section>
            )}
            <Section title="Departments" right={me.role === 'owner' && <Link to={`${base}/settings`} className="text-sm font-semibold text-accent no-underline hover:underline">Manage</Link>}>
              <ul className="m-0 list-none space-y-2.5 p-0">
                {departments.map((d) => (
                  <li key={d.id} className={cx('flex items-center gap-3 rounded-lg p-2.5', d.id === me.department ? 'bg-accent/5 ring-1 ring-accent/30' : 'bg-bg/50')}>
                    <span className="size-3 shrink-0 rounded-full" style={{ background: d.color }} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="m-0 truncate text-sm font-semibold text-ink">{d.name}</p>
                      <p className="m-0 text-xs text-dim">{d.managerName ? `Manager: ${d.managerName}` : 'No manager yet'} · {d.members} {d.members === 1 ? 'person' : 'people'}</p>
                    </div>
                    <Badge title="Context version">v{d.contextVersion}</Badge>
                  </li>
                ))}
              </ul>
              <p className="m-0 mt-3 text-xs text-dim">Central context is at v{data.centralVersion}.</p>
            </Section>
            {me.role === 'owner' && project.project_code && (
              <Section title="Share" description="People need the project ID to open the project.">
                <p className="m-0 text-sm text-dim">Project ID: <span className="font-mono font-semibold text-ink">{project.project_code}</span></p>
                <p className="m-0 mt-1 text-sm text-dim">Observer code: <span className="font-mono font-semibold text-ink">{project.observer_code}</span></p>
              </Section>
            )}
          </div>
        </div>
      </div>
    </Page>
  );
}

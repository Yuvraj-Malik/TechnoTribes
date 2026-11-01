// Common landing page for everyone after sign-in.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationsContext';
import { useApi } from '../../hooks/useApi';
import Alert from '../../components/common/Alert';
import Icon from '../../components/common/Icon';
import { focusRing } from '../../components/common/styles';
import {
  PageHeader, SectionHeader, StatTile, EmptyState, CardSkeleton, buttonPrimary, buttonSecondary,
} from '../../components/dashboard/ui';
import {
  MyProjectCard, ExploreProjectCard, EnterProjectDialog, JoinRequestDialog,
} from '../../components/dashboard/ProjectCards';
import { displayNameOf, greeting, timeAgo } from '../../utils/format';

export default function OverviewPage() {
  const { user } = useAuth();
  const me = useApi('auth/me');
  const discover = useApi('projects/discover');
  const requests = useApi('projects/my-requests');
  const { items: notifications, unread } = useNotifications();
  const [opening, setOpening] = useState(null);
  const [joining, setJoining] = useState(null);

  const projects = me.data?.projects || [];
  const pendingRequests = (requests.data?.requests || []).filter((r) => r.status === 'pending').length;
  const others = (discover.data?.projects || []).slice(0, 3);
  const firstName = displayNameOf(user).split(' ')[0];

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description="Pick up a project you're part of, or find a new one to join."
        actions={(
          <>
            <Link to="/onboarding?start=admin" className={buttonSecondary}><Icon name="key" size={17} /> Join with a code</Link>
            <Link to="/onboarding?start=founder" className={buttonPrimary}><Icon name="plus" size={17} /> New project</Link>
          </>
        )}
      />

      <div className="mb-10 grid grid-cols-3 gap-2.5 sm:gap-4">
        <StatTile label="My projects" value={me.loading ? '–' : projects.length} icon="folder" />
        <StatTile label="Requests sent" value={requests.loading ? '–' : pendingRequests} icon="inbox" />
        <StatTile label="Unread" value={unread} icon="bell" />
      </div>

      <section className="mb-10" aria-labelledby="my-projects">
        <SectionHeader title={<span id="my-projects">Your projects</span>} to={projects.length > 4 ? '/dashboard/projects' : undefined} />
        <Alert tone="error">{me.error}</Alert>
        {me.loading ? (
          <div className="grid gap-4 md:grid-cols-2"><CardSkeleton count={2} /></div>
        ) : projects.length === 0 ? (
          <EmptyState icon="folder" title="You're not in a project yet" text="Start your own, join with an invite code, or ask to join one below.">
            <Link to="/onboarding?start=founder" className={buttonPrimary}><Icon name="plus" size={17} /> New project</Link>
            <Link to="/dashboard/explore" className={buttonSecondary}>Explore projects</Link>
          </EmptyState>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {projects.slice(0, 4).map((p) => <MyProjectCard key={p.projectId} project={p} onOpen={setOpening} />)}
          </div>
        )}
      </section>

      <div className="grid gap-10 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-labelledby="discover">
          <SectionHeader title={<span id="discover">Other projects</span>} to="/dashboard/explore" linkLabel="Explore all" />
          <Alert tone="error">{discover.error}</Alert>
          {discover.loading ? (
            <div className="grid gap-4 md:grid-cols-2"><CardSkeleton count={2} /></div>
          ) : others.length === 0 ? (
            <EmptyState icon="compass" title="Nothing to explore yet" text="New projects from other teams will show up here." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {others.slice(0, 2).map((p) => <ExploreProjectCard key={p.id} project={p} onRequest={setJoining} />)}
            </div>
          )}
        </section>

        <section aria-labelledby="activity">
          <SectionHeader title={<span id="activity">Recent activity</span>} to="/dashboard/notifications" />
          <div className="rounded-xl border border-line bg-surface">
            {notifications.length === 0 ? (
              <p className="m-0 px-5 py-8 text-center text-sm text-dim">No activity yet.</p>
            ) : (
              <ul className="m-0 list-none p-0">
                {notifications.slice(0, 5).map((n) => (
                  <li key={n.id} className="flex gap-3 border-b border-line px-4 py-3.5 last:border-0">
                    <span className={`mt-2 size-2 shrink-0 rounded-full ${n.read ? 'bg-line' : 'bg-accent'}`} aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="m-0 text-sm font-semibold">{n.title}</p>
                      <p className="m-0 mt-0.5 text-xs text-dim">{timeAgo(n.created_at)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Link to="/dashboard/requests" className={`mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent no-underline hover:underline ${focusRing}`}>
            Track your join requests <Icon name="arrowRight" size={16} />
          </Link>
        </section>
      </div>

      <EnterProjectDialog project={opening} onClose={() => setOpening(null)} />
      <JoinRequestDialog
        project={joining}
        onClose={() => setJoining(null)}
        onSent={() => { discover.reload(); requests.reload(); }}
      />
    </>
  );
}

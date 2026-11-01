// /projects/:projectId/*: Nadeem's team workspace inside our app shell.
// The project ID gate comes first; then the project's pages appear as tabs in the
// sidebar, and a slim project bar sits under the navbar.
import { Outlet, useParams } from 'react-router-dom';
import { TeamProvider, useTeam } from '../../context/TeamContext';
import { useShellSection } from '../../context/ShellContext';
import TeamTopBar from '../../components/layout/TeamTopBar';
import ProjectGate from '../../components/projects/ProjectGate';
import ProjectOverview from './ProjectOverview';
import { ObserverUpdates } from '../observer/ObserverPages';

// Sidebar tabs by role. Demo mode (owner acting as someone) shows that person's tabs.
function projectTabs({ me, projectId }) {
  const base = `/projects/${projectId}`;
  const t = (path, label, icon) => ({ to: `${base}${path}`, label, icon, end: path === '' });
  if (me.role === 'observer') {
    return [t('', 'Updates', 'home'), t('/site', 'Live site', 'compass'), t('/requests', 'My requests', 'inbox'), t('/story', 'Story', 'book')];
  }
  if (me.role === 'worker') {
    return [t('', 'Overview', 'home'), t('/workspace', 'My workspace', 'code'), t('/tasks', 'My tasks', 'check'),
      t('/submissions', 'My submissions', 'review'), t('/context', 'Context', 'key'), t('/team', 'Team', 'users'), t('/story', 'Story', 'book')];
  }
  const owner = me.role === 'owner';
  return [
    t('', 'Overview', 'home'),
    t('/review', 'Review', 'review'),
    t('/approvals', 'Approvals', 'lock'),
    t('/tasks', 'Tasks', 'check'),
    t('/context', 'Context', 'key'),
    t('/team', owner ? 'Members' : 'Team', 'users'),
    t('/requests', 'Requests', 'inbox'),
    t('/story', 'Story', 'book'),
    owner && !me.actingAs && t('/settings', 'Settings', 'settings'),
  ].filter(Boolean);
}

function Shell() {
  const team = useTeam();
  useShellSection({ title: team.boot.project.name, items: projectTabs(team) });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {team.me.role !== 'observer' && <TeamTopBar />}
      <div className="min-h-0 flex-1 overflow-auto lg:overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}

export default function TeamLayout() {
  const { projectId } = useParams();
  return (
    <ProjectGate key={projectId} projectId={projectId}>
      <TeamProvider><Shell /></TeamProvider>
    </ProjectGate>
  );
}

/** The project's home tab: the observer gets plain-language updates, everyone else the overview. */
export function TeamHome() {
  const { me } = useTeam();
  return me.role === 'observer' ? <ObserverUpdates /> : <ProjectOverview />;
}

// Shell for /projects/:projectId/*: loads the team, shows the top bar, and
// sends "/projects/:id/team" to the right page for the acting person.
import { Navigate, Outlet } from 'react-router-dom';
import { TeamProvider, useTeam } from '../../context/TeamContext';
import TeamTopBar from '../../components/layout/TeamTopBar';

function Shell() {
  return (
    <div className="flex h-screen flex-col">
      <TeamTopBar />
      <main className="min-h-0 flex-1 overflow-hidden"><Outlet /></main>
    </div>
  );
}

export default function TeamLayout() {
  return <TeamProvider><Shell /></TeamProvider>;
}

export function TeamHome() {
  const { me, boot, projectId } = useTeam();
  if (!boot.demoReady) return <Navigate to={`/projects/${projectId}/${boot.canUseDemoMode ? 'setup' : 'story'}`} replace />;
  const page = me.isDeveloper ? 'workspace' : me.isManager && me.role !== 'owner' ? 'review' : 'story';
  return <Navigate to={`/projects/${projectId}/${page}`} replace />;
}

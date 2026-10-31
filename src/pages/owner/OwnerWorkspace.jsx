// The owner's workspace: the sidebar, the shared project data, and one route per tab.
import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { OwnerContext } from '../../features/projects/ownerContext';
import { useProjectOverview } from '../../features/projects/useProjectOverview';
import { buildNeedsYou } from '../../features/projects/overviewModel';
import { personColors } from '../../features/coordination/codeModel';
import PageShell from '../../components/layout/PageShell';
import OwnerSidebar from '../../components/layout/OwnerSidebar';
import Alert from '../../components/common/Alert';
import { linkButton } from '../../components/common/styles';
import OverviewTab from './OverviewTab';
import BriefTab from './BriefTab';
import CodeTab from './CodeTab';
import TeamTab from './TeamTab';
import AgentsTab from './AgentsTab';
import MessagesTab from './MessagesTab';
import SettingsTab from './SettingsTab';

export default function OwnerWorkspace({ projectId }) {
  const { user, signOut } = useAuth();
  const overview = useProjectOverview(projectId, user.id);
  const { data, error, actionError, reload } = overview;
  const projectName = data?.project.name;
  const { pathname } = useLocation();

  useEffect(() => {
    if (projectName) document.title = `${projectName} · Buildify`;
  }, [projectName]);

  // Each tab opens at its top, not wherever the last tab was scrolled to.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  if (!data) {
    return (
      <PageShell>
        <Alert tone="error">{error}</Alert>
        {error
          ? <button type="button" className={linkButton} onClick={reload}>Try again</button>
          : <p className="text-dim" role="status">Loading…</p>}
      </PageShell>
    );
  }

  const { items, withAdmins } = buildNeedsYou(data);
  const me = data.members.find((m) => m.user_id === user.id);
  const version = data.log[0]?.version ?? 0;
  const base = `/projects/${projectId}/owner`;
  const value = {
    ...overview,
    projectId,
    base,
    me,
    version,
    needsYou: items,
    withAdmins,
    colors: personColors(data.members),
    signOut,
  };

  return (
    <OwnerContext.Provider value={value}>
      <OwnerSidebar
        base={base}
        projectName={projectName}
        version={version}
        ownerName={me?.name || user.email}
        needsYouCount={items.length}
        onSignOut={signOut}
      />
      <div className="lg:pl-56">
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
          {error && (
            <div className="mb-4">
              <Alert tone="error">This may be out of date. {error}</Alert>
              <button type="button" className={linkButton} onClick={reload}>Try again</button>
            </div>
          )}
          <Alert tone="error">{actionError}</Alert>
          <Routes>
            <Route index element={<OverviewTab />} />
            <Route path="brief" element={<BriefTab />} />
            <Route path="code" element={<CodeTab />} />
            <Route path="team" element={<TeamTab />} />
            <Route path="agents" element={<AgentsTab />} />
            <Route path="messages" element={<MessagesTab />} />
            <Route path="settings" element={<SettingsTab />} />
            <Route path="*" element={<OverviewTab />} />
          </Routes>
        </main>
      </div>
    </OwnerContext.Provider>
  );
}

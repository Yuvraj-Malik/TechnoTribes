// Opens a project on the right screen for the signed-in person's role.
// This only picks the screen: the API still checks every role itself.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../services/apiClient';
import PageShell from '../components/layout/PageShell';
import Alert from '../components/common/Alert';
import { heading } from '../components/common/styles';
import OwnerWorkspace from '../pages/owner/OwnerWorkspace';

export default function ProjectRoute() {
  const { projectId } = useParams();
  const [membership, setMembership] = useState(undefined); // undefined = still loading
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setMembership(undefined);
    setError('');
    api('auth/me')
      .then((me) => { if (active) setMembership(me.projects.find((p) => p.projectId === projectId) ?? null); })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [projectId]);

  if (membership?.role === 'owner' && membership.status === 'active') {
    return <OwnerWorkspace key={projectId} projectId={projectId} />;
  }

  let title = "You're not part of this project";
  let text = 'Ask the project owner for an invite code.';
  if (membership?.status === 'pending') {
    title = 'Waiting for approval';
    text = `The owner still needs to approve you for ${membership.name}.`;
  } else if (membership) {
    title = membership.name;
    text = 'This screen is still being built.';
  }

  return (
    <PageShell>
      <Alert tone="error">{error}</Alert>
      {membership === undefined && !error && <p className="text-dim" role="status">Loading…</p>}
      {membership !== undefined && (
        <>
          <h1 className={heading}>{title}</h1>
          <p className="text-dim">{text}</p>
          <Link to="/projects" className="text-sm font-semibold text-accent">Back to your projects</Link>
        </>
      )}
    </PageShell>
  );
}

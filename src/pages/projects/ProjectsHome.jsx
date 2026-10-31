// Placeholder home after sign-in: lists the user's projects. The real
// role dashboards (owner/admin/worker/observer) will replace this.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import { Logo } from '../../components/auth/BrandPanel';
import ThemeToggle from '../../components/common/ThemeToggle';
import Alert from '../../components/common/Alert';
import { focusRing, heading } from '../../components/common/styles';

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', worker: 'Worker', observer: 'Observer' };

export default function ProjectsHome() {
  const { user, signOut } = useAuth();
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('auth/me').then((me) => setProjects(me.projects)).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-6">
      <header className="mb-10 flex flex-wrap items-center justify-between gap-3">
        <Logo />
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <button type="button" onClick={signOut} className={`min-h-11 cursor-pointer rounded-full border border-line bg-surface px-3.5 text-[13px] font-medium text-dim ${focusRing}`}>
            Sign out
          </button>
        </div>
      </header>

      <h1 className={heading}>Your projects</h1>
      <p className="mb-6 text-dim">Signed in as {user?.email}</p>
      <Alert tone="error">{error}</Alert>

      {projects === null && !error && <p className="text-dim">Loading…</p>}
      {projects?.length === 0 && (
        <p className="text-dim">
          You are not in any project yet. <Link to="/onboarding" className="font-semibold text-accent">Start or join one</Link>
        </p>
      )}
      <ul className="m-0 grid list-none gap-3 p-0">
        {projects?.map((p) => (
          <li key={p.projectId} className="flex items-center justify-between gap-3 rounded-[10px] border border-line bg-surface px-4 py-3.5">
            <div>
              <div className="font-semibold">{p.name}</div>
              {p.description && <div className="text-sm text-dim">{p.description}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="rounded-full border border-line px-3 py-1 text-[13px] text-dim">
                {ROLE_LABEL[p.role]}{p.status === 'pending' ? ' (waiting for approval)' : ''}
              </span>
              {p.status === 'active' && p.role !== 'observer' && (
                <Link to={`/projects/${p.projectId}`} className={`rounded-full bg-accent px-3 py-1 text-[13px] font-semibold text-accent-ink no-underline ${focusRing}`}>
                  Open team workspace
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
      {projects?.length > 0 && (
        <p className="mt-6 text-sm"><Link to="/onboarding" className="font-semibold text-accent">Start or join another project</Link></p>
      )}
    </div>
  );
}

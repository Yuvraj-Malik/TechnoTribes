// The team workspace for one project: who is acting, departments, people,
// agent mode, and a shared refresh tick (polls every few seconds so several
// people see each other's changes without reloading).
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../services/apiClient';

const TeamContext = createContext(null);
const POLL_MS = 3000;

export function TeamProvider({ children }) {
  const { projectId } = useParams();
  const [boot, setBoot] = useState(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [actAs, setActAsState] = useState(() => sessionStorage.getItem('actAs') || '');

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    api('team/bootstrap', { query: { projectId } })
      .then((b) => { setBoot(b); setError(''); })
      .catch((e) => {
        // A stale demo person from another project: drop it and retry as yourself.
        if (sessionStorage.getItem('actAs')) { sessionStorage.removeItem('actAs'); setActAsState(''); return; }
        setError(e.message);
      });
  }, [projectId, actAs]);

  const value = useMemo(() => {
    if (!boot) return null;
    const personById = (id) => boot.people.find((p) => p.id === id);
    return {
      projectId, boot, tick, refresh,
      me: boot.me,
      dept: boot.departments.find((d) => d.id === boot.me.department) ?? null,
      personById,
      deptById: (id) => boot.departments.find((d) => d.id === id),
      nameOf: (id) => (id ? personById(id)?.name ?? 'Someone' : 'System'),
      actAs,
      setActAs: (id) => {
        if (id) sessionStorage.setItem('actAs', id); else sessionStorage.removeItem('actAs');
        setActAsState(id);
        setBoot(null);
      },
      reload: () => api('team/bootstrap', { query: { projectId } }).then(setBoot),
      /** Team API calls with projectId filled in. */
      get: (path, query = {}) => api(`team/${path}`, { query: { projectId, ...query } }),
      post: (path, body = {}) => api(`team/${path}`, { method: 'POST', body: { projectId, ...body } }),
    };
  }, [boot, tick, projectId, actAs, refresh]);

  if (error) return <div className="mx-auto max-w-xl p-8 text-err" role="alert">Could not open the team workspace: {error}</div>;
  if (!value) return <div className="grid flex-1 place-items-center p-10 text-dim" role="status">Loading project…</div>;
  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
}

export function useTeam() {
  const ctx = useContext(TeamContext);
  if (!ctx) throw new Error('useTeam must be used inside <TeamProvider>');
  return ctx;
}

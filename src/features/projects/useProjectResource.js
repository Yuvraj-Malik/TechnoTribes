// Loads one API route for the open project, and loads it again whenever the
// project changes, so a tab's own data stays as live as the rest of the workspace.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../services/apiClient';
import { useOwner } from './ownerContext';

export function useProjectResource(route) {
  const { projectId, tick } = useOwner();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const latest = useRef(0);

  const load = useCallback(async () => {
    const run = ++latest.current;
    try {
      const result = await api(route, { query: { projectId } });
      if (run !== latest.current) return;
      setData(result);
      setError('');
    } catch (err) {
      if (run === latest.current) setError(err.message);
    }
  }, [route, projectId]);

  useEffect(() => { load(); }, [load, tick]);

  return { data, error, reload: load };
}

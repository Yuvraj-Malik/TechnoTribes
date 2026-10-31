// Loads what every owner tab needs and keeps it live. `tick` goes up after each
// refresh, so tabs with data of their own know when to load again.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../services/apiClient';
import { useProjectRealtime } from '../../hooks/useProjectRealtime';

export function useProjectOverview(projectId, userId) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [tick, setTick] = useState(0);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const run = ++latest.current; // ignore slower, older responses
    const query = { projectId };
    try {
      const [{ project }, { members, joinRequests }, queue, { requests }, { entries }] = await Promise.all([
        api('projects/get', { query }),
        api('projects/members', { query }),
        api('reviews/queue', { query }),
        api('observer/requests', { query }),
        api('moderator/log', { query: { ...query, limit: 100 } }),
      ]);
      if (run !== latest.current) return;
      setData({ project, members, joinRequests, queue, requests, log: entries });
      setError('');
      setTick((t) => t + 1);
    } catch (err) {
      if (run === latest.current) setError(err.message);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);
  useProjectRealtime(projectId, userId, load);

  const act = useCallback(async (route, body) => {
    setActionError('');
    try {
      await api(route, { method: 'POST', body });
      await load();
      return true;
    } catch (err) {
      setActionError(err.message);
      return false;
    }
  }, [load]);

  // A decision can come back 200 and still be refused, when the work turns out to be out of date.
  const decide = useCallback(async (mergeRequestId, decision, note) => {
    setActionError('');
    try {
      const { results } = await api('reviews/decide', {
        method: 'POST',
        body: { projectId, decisions: [{ mergeRequestId, decision, note }] },
      });
      const [result] = results;
      if (result?.conflict) setActionError('That change was based on older work, so it needs a re-run first.');
      else if (!result?.ok) setActionError(result?.error || 'Something went wrong');
      await load();
    } catch (err) {
      setActionError(err.message);
    }
  }, [projectId, load]);

  return { data, error, actionError, tick, reload: load, act, decide };
}

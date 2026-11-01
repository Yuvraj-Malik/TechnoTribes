// Load data from our API with loading/error state and a reload() function.
// Pass a falsy path to skip loading.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/apiClient';

export function useApi(path, query) {
  const key = path + JSON.stringify(query || {});
  const [state, setState] = useState({ data: null, error: '', loading: true });

  const load = useCallback(async () => {
    if (!path) { setState({ data: null, error: '', loading: false }); return; }
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const data = await api(path, { query });
      setState({ data, error: '', loading: false });
    } catch (err) {
      setState({ data: null, error: err.message, loading: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

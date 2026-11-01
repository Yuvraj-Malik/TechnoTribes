// Calls our backend (/api/*) with the current user's session token.
import { supabase } from '../lib/supabaseClient';

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let endingSession = null;

// The session was revoked (password changed, signed out elsewhere) or expired.
async function endSession() {
  if (!endingSession) {
    endingSession = (async () => {
      try { sessionStorage.setItem('buildify:sessionEnded', '1'); } catch { /* storage blocked */ }
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    })().finally(() => { endingSession = null; });
  }
  return endingSession;
}

export async function api(path, opts = {}, retried = false) {
  const { method = 'GET', body, query } = opts;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const qs = query ? `?${new URLSearchParams(query)}` : '';
  // Demo mode (project owner only): act as a demo person. Kept per browser tab,
  // and only sent to the team workspace endpoints.
  let actAs = null;
  if (path.replace(/^\/+/, '').startsWith('team/')) {
    try { actAs = sessionStorage.getItem('actAs'); } catch { /* storage blocked */ }
  }
  const res = await fetch(`/api/${path.replace(/^\/+/, '')}${qs}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(actAs ? { 'x-act-as': actAs } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && token) {
    if (!retried) {
      const { data: refreshed, error } = await supabase.auth.refreshSession();
      if (!error && refreshed.session) return api(path, opts, true);
    }
    await endSession();
    throw new ApiError(401, 'Your session ended. Please log in again.');
  }
  if (!res.ok) throw new ApiError(res.status, json.error || 'Something went wrong', json.details);
  return json;
}

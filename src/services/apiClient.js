// Calls our backend (/api/*) with the current user's session token.
import { supabase } from '../lib/supabaseClient';

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api(path, { method = 'GET', body, query } = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const qs = query ? `?${new URLSearchParams(query)}` : '';
  // Demo mode (project owner only): act as a demo person. Kept per browser tab.
  const actAs = sessionStorage.getItem('actAs');
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
  if (!res.ok) throw new ApiError(res.status, json.error || 'Something went wrong', json.details);
  return json;
}

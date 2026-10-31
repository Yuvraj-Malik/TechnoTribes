// Request helpers: auth, body parsing, field validation.
import { db } from './supabase-admin.js';
import { HttpError } from './errors.js';

export function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) {
    try { return JSON.parse(req.body); } catch { throw new HttpError(400, 'Body must be valid JSON'); }
  }
  return {};
}

// The frontend sends the Supabase session token: Authorization: Bearer <access_token>
export async function getUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Please sign in');
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'Your session has expired. Please sign in again');
  return data.user;
}

export function requireFields(obj, fields) {
  const missing = fields.filter((f) => obj?.[f] === undefined || obj?.[f] === null || obj?.[f] === '');
  if (missing.length) throw new HttpError(400, `Missing fields: ${missing.join(', ')}`);
}

export function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value) return value.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

export function displayName(user) {
  return user?.user_metadata?.display_name || user?.display_name || user?.email || 'Someone';
}

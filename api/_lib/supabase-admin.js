// Supabase client with the SERVICE ROLE key. Server only: never import this from src/.
import { createClient } from '@supabase/supabase-js';
import { HttpError } from './errors.js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if ((!url || !key) && !globalThis.__TEST_DB__) console.warn('[supabase-admin] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing');

// Tests can provide an in-memory client (tests/integration/fake-supabase.js).
export const db = globalThis.__TEST_DB__ ?? createClient(url || 'http://localhost', key || 'missing', {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Await a Supabase query and throw on error, returning only the data.
export async function q(query) {
  const { data, error } = await query;
  if (error) {
    if (error.code === '23505') throw new HttpError(409, 'That already exists', error.message);
    if (error.code === 'PGRST116') throw new HttpError(404, 'Not found');
    throw new HttpError(500, `Database error: ${error.message}`);
  }
  return data;
}

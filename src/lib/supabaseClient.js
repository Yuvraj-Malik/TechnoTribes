// Browser Supabase client. Uses the PUBLIC anon key only.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local.');
}

export const supabase = createClient(url || 'http://localhost', anonKey || 'missing', {
  auth: {
    flowType: 'pkce',         // Google sign-in and reset links come back with ?code=...
    detectSessionInUrl: true, // ...which supabase-js exchanges for a session automatically
    persistSession: true,
    autoRefreshToken: true,
  },
});

// Where Supabase sends people back to after Google sign-in, email confirmation or a reset link.
export const redirectTo = (path) => `${window.location.origin}${path}`;

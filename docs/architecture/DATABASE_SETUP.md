# Database + Google sign-in setup

You need a Supabase project first (supabase.com → New project). Then pick **one** of the two options.

---

## Option A: Supabase CLI (recommended)

The CLI is already a dev dependency, so `npm install` gives you everything.

### 1. Create the tables
```bash
npm run db:login      # opens the browser to log in to Supabase (once per computer)
npm run db:link       # pick your project; asks for the database password you set when creating it
npm run db:push       # creates all tables, triggers and access rules
```
`db:push` runs everything in `supabase/migrations/` in order:
- `001_init.sql`: 19 tables, the profile-on-signup trigger, the permanent Moderator log
- `002_rls.sql`: row-level security and Realtime

### 2. Turn on Google sign-in
1. **Google Cloud Console** → APIs & Services → **OAuth consent screen**: set it up (External, app name, your email).
2. **Credentials** → **Create credentials** → **OAuth client ID** → *Web application*.
   - **Authorized JavaScript origins:** `http://localhost:3000` (and later your Vercel URL)
   - **Authorized redirect URIs:** `https://<your-project-ref>.supabase.co/auth/v1/callback`
     (your project ref is in the Supabase URL, e.g. `abcdefghijklmnopqrst`)
3. Copy `supabase/.env.example` to `supabase/.env` and paste the **Client ID** and **Client secret**.
4. Run:
```bash
npm run db:auth       # pushes supabase/config.toml: enables Google, sets redirect URLs, turns off email confirmation
```
It shows the exact changes and asks before applying each one.

### Later changes
To change the database, add a new file such as `supabase/migrations/003_add_something.sql` and run `npm run db:push`. Never edit a migration that has already been pushed.

---

## Option B: no CLI (dashboard only)

1. Supabase dashboard → **SQL Editor** → New query → paste all of `supabase/setup.sql` → **Run**. Run it once, on a fresh project.
2. Do Google Cloud steps 1–2 above.
3. Supabase dashboard → **Authentication → Sign In / Providers → Google** → enable, paste Client ID and secret, save.
4. **Authentication → URL Configuration:**
   - Site URL: `http://localhost:3000`
   - Redirect URLs: `http://localhost:3000/**`, `https://*.vercel.app/**`
5. **Authentication → Sign In / Providers → Email:** turn off **Confirm email** for the demo.

---

## Then
Fill in `.env.local` (copy `.env.example`):
- `SUPABASE_URL` and `VITE_SUPABASE_URL`: Project Settings → API → Project URL
- `VITE_SUPABASE_ANON_KEY`: the `anon` / publishable key
- `SUPABASE_SERVICE_ROLE_KEY`: the `service_role` / secret key (server only, never in `src/`)
- `ANTHROPIC_API_KEY`

Then `npm run dev` and open http://localhost:3000.

## Troubleshooting
| Error | Fix |
|---|---|
| `Unsupported provider: provider is not enabled` | Google is not enabled yet. Do step 2 of Option A, or step 3 of Option B |
| `redirect_uri_mismatch` (Google page) | The redirect URI in Google Cloud must be exactly `https://<ref>.supabase.co/auth/v1/callback` |
| Google signs in but you land back on `/login` | Add `http://localhost:3000/**` to Supabase Redirect URLs |
| `relation "public.projects" does not exist` | The tables were not created. Run `npm run db:push` or `supabase/setup.sql` |
| `db:push` says a type or table already exists | `setup.sql` was already run in the dashboard. Use one option, not both |

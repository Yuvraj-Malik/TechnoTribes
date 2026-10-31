# Database + Google sign-in setup

For the shared project, create one at supabase.com → New project, then pick Option A or B. To test on your own computer without an account, use Option C.

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
- `004_owner_workspace.sql`: teams and designations, the owner's Builder + Critic, and owner-to-admin messages

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
To change the database, add a new file such as `supabase/migrations/005_add_something.sql` and run `npm run db:push`. Never edit a migration that has already been pushed.

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

## Option C: local Supabase (no account)

Runs the real Supabase stack on your computer, so testing can't touch the team's data. It needs Docker. On Windows, use Docker inside WSL and run the `supabase` commands there. Keep an Ubuntu window open while you work: WSL shuts down soon after the last window closes, and Supabase stops with it. Your data is kept, and it comes back when you open Ubuntu again.

1. Start it. The first run downloads a few GB, then applies everything in `supabase/migrations/`:
```bash
supabase start -x edge-runtime,imgproxy,storage-api,vector,logflare,studio,postgres-meta,mailpit
```
2. Print the local URL and keys:
```bash
supabase status -o env
```
3. Create `.env.local`:

| `.env.local` | Value from `supabase status` |
|---|---|
| `SUPABASE_URL`, `VITE_SUPABASE_URL` | `API_URL` |
| `VITE_SUPABASE_ANON_KEY` | `ANON_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY` | `SERVICE_ROLE_KEY` |

4. Add a sample team and project, then open the app. The sign-in details are at the top of `scripts/seed.js`:
```bash
npm run seed
npm run dev
```
5. Check the whole backend against the real database. This fakes Claude only, so it needs no API key and spends no credits:
```bash
npm run test:supabase
```

`npm run seed` and `npm run test:supabase` refuse to run against anything except a local Supabase. To wipe the local data and start again, run `supabase db reset`. Without `ANTHROPIC_API_KEY`, the app works but running a Builder or Critic shows an error.

---

## Then
For Option A or B, fill in `.env.local` (copy `.env.example`):
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
| `column project_members.team does not exist` | The database is missing a migration. Run `npm run db:push` |
| `fetch failed` or `ECONNREFUSED` on port 54321 | Local Supabase has stopped. On Windows, open Ubuntu to bring it back |

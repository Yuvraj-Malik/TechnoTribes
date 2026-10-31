# Auth setup (Supabase + Google)

## 1. Environment
Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
(Supabase → Project Settings → API), plus the server keys.

## 2. Redirect URLs
Supabase → Authentication → URL Configuration:
- **Site URL:** your Vercel URL, e.g. `https://technotribes.vercel.app`
- **Redirect URLs:** add
  - `http://localhost:3000/**` (`vercel dev`)
  - `http://localhost:5173/**` (`vite` on its own)
  - `https://technotribes.vercel.app/**`

The app sends people back to `/auth/callback` (Google, email confirmation) and `/reset-password` (reset link).

## 3. Google sign-in
1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID** → *Web application*.
2. **Authorized redirect URI:** `https://<your-project-ref>.supabase.co/auth/v1/callback`
3. Copy the Client ID and Client Secret.
4. Supabase → Authentication → Providers → **Google** → enable, paste both, save.

## 4. Email (confirmations and password resets)
Supabase sends these with its built-in mailer, which is rate-limited (a few emails per hour) and fine for development.
For the demo, either turn off **Confirm email** (Authentication → Providers → Email) or add your own SMTP
under Authentication → Emails → SMTP Settings.

## How the flows work
| Flow | What happens |
|---|---|
| Email sign-up | `signUp` → if email confirmation is on, the user gets a link → `/auth/callback` → `/onboarding` |
| Email log in | `signInWithPassword` → `/` → `/projects` (or `/onboarding` if they have no project yet) |
| Google | `signInWithOAuth` → Google → Supabase → `/auth/callback` → `/` |
| Forgot password | `resetPasswordForEmail` → email link → `/reset-password` (recovery session) → `updateUser({ password })` |
| Onboarding | Founder → `POST /api/projects/create` (becomes Owner, gets the observer code). Teammate → `POST /api/projects/join` with an `ADM-` or `OBS-` code |

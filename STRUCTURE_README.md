# Technotribes: Folder Structure Guide

This guide says what code goes in each folder of the project.

**Stack:** React (JavaScript) + Vite + Tailwind CSS · Supabase (Postgres, Auth, Realtime) · Claude API · Vercel (hosting + serverless functions)

**Golden rules**
1. Anything that uses a secret (Claude API key, Supabase service key, GitHub token) goes in `api/`, never in `src/`.
2. `src/` is the browser. It talks to Supabase with the public anon key, and to `api/` for anything privileged.
3. Permissions are enforced in two places: Supabase row-level security (`supabase/policies/`) and server checks (`api/auth/`). The UI hides buttons, but it is never the security boundary.
4. Agents never write to the project directly. They create proposals. Only an admin approval makes the Moderator record a change.

---

## Root files (created when we scaffold Vite)

| File | Purpose |
|---|---|
| `package.json` | Dependencies and scripts (`dev`, `build`, `seed`, `test`) |
| `vite.config.js` | Vite + React config |
| `tailwind.config.js`, `postcss.config.js` | Tailwind setup |
| `index.html` | Vite entry HTML |
| `vercel.json` | Vercel routing for `/api/*` functions |
| `.env.example` | Names of every env variable, with no real values |
| `.env.local` | Real keys. Never committed (in `.gitignore`) |
| `.gitignore` | Ignores `node_modules`, `.env.local`, `dist` |
| `README.md` | Setup instructions, demo link, Functional vs Simulated list |

---

## Update: how the backend is actually laid out

Vercel's free plan allows only 12 serverless functions, and we have 50 endpoints. So the whole backend runs as **one** function:

- `api/index.js`: the router. `vercel.json` sends every `/api/<route>` here.
- `api/_lib/`: shared server logic (Claude, Supabase, permissions, Moderator, coordination, dependency graph, bucketing). The underscore stops Vercel from turning it into separate functions.
- `server/`: the endpoint handlers, one file per area (`projects.js`, `reviews.js`, `agents/builder.js`, ...).

The empty `api/agents`, `api/coordination`, `api/reviews` (etc.) folders below are no longer used and can be deleted. The table below still describes what each area does; the code for it is in `server/<area>.js`. The full endpoint list and the 4-person split are in `docs/api/API_REFERENCE.md`.

---

## `api/`: server side (original plan)

Originally each `.js` file was going to be its own endpoint, e.g. `api/reviews/bucket.js` → `POST /api/reviews/bucket`.

### `api/agents/builder/`
The Builder agent: it writes code changes.
- `run.js`: endpoint that starts a Builder task for one person
- `prompt.js`: Builder role instructions and the prompt template
- `schema.js`: the JSON shape Claude must return (files changed, code, summary, reason, dependencies used)
- `validate.js`: checks and cleans Claude's output before it becomes a proposal

### `api/agents/critic/`
The Critic agent: it reviews work and prioritizes review buckets.
- `review.js`: reviews one person's Builder output (issues, risks, suggestions)
- `prioritize.js`: ranks review buckets for the admin (blocking others, risk, conflicts, staleness, observer requests)
- `prompt.js`, `schema.js`: Critic instructions and output shape

### `api/agents/moderator/`
The Moderator agent: final approved truth plus team-wide coordination.
- `record.js`: on admin approval, writes the change to the final log and updates the dependency graph
- `context.js`: builds the context packet every agent fetches before working (final log, current state, active intents, dependencies)
- `completeness.js`: refuses to start a task if something it depends on is missing, and says what is missing
- `observer-summary.js`: turns changes into plain language for the observer (what changed, what's happening now, what's next)
- `prompt.js`: Moderator instructions

### `api/coordination/`
Agent-to-agent awareness, so two agents don't work on the same thing.
- `declare-intent.js`: an agent announces what it is about to touch and why
- `check-overlap.js`: compares an intent with all active intents using the dependency graph (same target / dependent target / clear)
- `release-intent.js`: clears an intent when work is finished, merged or abandoned
- `notify-dependents.js`: tells only the affected agents when something they depend on changes

### `api/reviews/`
Merge requests and review triage.
- `submit.js`: worker nudges the admin with a merge request listing every change
- `bucket.js`: groups similar reviews (same files, same intent, same issue type)
- `decide.js`: admin approves, rejects or redirects a single item or a whole bucket
- `merge-check.js`: blocks approval if the proposal was based on an outdated version (conflict)

### `api/github/`
Working with the project's code on GitHub. *(Scope depends on whether we use a real repo; decision pending.)*
- `fetch-repo.js`: gets the latest code / file tree for agents
- `branch.js`: creates a personal branch per worker
- `pull-request.js`: opens or updates a PR when a merge is approved
- `client.js`: GitHub API setup

### `api/projects/`
Project setup and access codes.
- `create.js`: creates a project; the creator becomes the Owner
- `observer-code.js`: generates / regenerates the project's observer code
- `admin-code.js`: Owner creates admin codes and approves admins
- `join.js`: redeem an admin code, or a worker requests to join

### `api/auth/`
Server-side permission checks.
- `require-role.js`: helper that blocks a request unless the user has the right role in that project
- `permissions.js`: the server's copy of who-can-do-what

### `api/notifications/`
- `send.js`: creates notifications (observer: request accepted / rejected / done; admin: new merge request, new observer request)
- `observer-request.js`: observer asks the admin for a change (cannot assign agents)

### `api/_lib/`
Shared server helpers. The underscore stops Vercel from treating these as endpoints.
- `claude.js`: Claude API client, retries and timeouts
- `supabase-admin.js`: Supabase client with the service key (server only)
- `dependency-graph.js`: graph logic: add nodes and edges, find everything downstream of a change
- `errors.js`, `logger.js`: consistent errors and event logging

---

## `src/`: frontend (React)

### `src/main.jsx`, `src/App.jsx`
App entry point, providers and router.

### `src/assets/`
- `images/`: logos, illustrations, empty-state art
- `icons/`: SVG icons

### `src/components/`: reusable UI pieces (no data fetching)

| Folder | Contents |
|---|---|
| `common/` | Button, Modal, Badge, Input, Card, Avatar, Spinner, Tooltip, EmptyState |
| `layout/` | Navbar, Sidebar, PageShell, RoleBanner, ProjectSwitcher |
| `agents/` | AgentStatusCard (idle / working on X / blocked / stale), AgentActivityFeed |
| `coordination/` | WhoIsWorkingBoard, OverlapWarning, IntentCard |
| `reviews/` | ReviewBucket, PriorityList, ChangeList, DiffViewer, DecisionButtons (approve / reject / redirect) |
| `dependency-graph/` | GraphView, GraphNode, ImpactPreview ("this change affects…") |
| `preview/` | SitePreview (sandboxed live preview of the website being built) |
| `timeline/` | Timeline, TimelineItem (what changed / why / what's next) |
| `notifications/` | NotificationBell, NotificationList |

### `src/pages/`: one screen per route, grouped by role

| Folder | Screens |
|---|---|
| `auth/` | Login, Signup, EnterAdminCode, EnterObserverCode |
| `projects/` | ProjectList, CreateProject, JoinRequest |
| `owner/` | OwnerWorkspace (sidebar + one route per tab): Overview, Brief, Code, Team, My agents, Messages, Settings |
| `admin/` | AdminDashboard, ManageWorkers, AssignTasks, ReviewQueue (buckets + priority), ObserverRequests |
| `worker/` | WorkerWorkspace (own Builder + Critic), MyHistory, SubmitMergeRequest |
| `observer/` | ObserverHome (progress), CurrentSite, Roadmap, RequestChange. Plain language only, no technical detail |

### `src/features/`: logic per domain (data fetching, state, rules)
Each folder holds that domain's hooks and API calls, e.g. `useReviewBuckets.js`, `reviewsApi.js`.

| Folder | Handles |
|---|---|
| `auth/` | Login state, current user, role per project |
| `projects/` | Project data, codes |
| `members/` | Admins, workers, join requests |
| `agents/` | Starting agent runs, agent status, realtime updates |
| `coordination/` | Live intents board, overlap alerts |
| `reviews/` | Merge requests, buckets, priority, decisions |
| `dependency-graph/` | Loading the graph, impact preview before a change |
| `history/` | Personal history (deletable by its owner only) |
| `notifications/` | Realtime notifications |
| `observer/` | Observer summaries, roadmap, change requests |

### Other `src/` folders

| Folder | Contents |
|---|---|
| `hooks/` | Generic hooks used everywhere: `useRealtime`, `useDebounce`, `useRole` |
| `context/` | React context providers: `AuthContext`, `ProjectContext` (active project + role) |
| `services/` | Thin wrappers for calling our `/api/*` endpoints (`apiClient.js`) |
| `lib/` | Third-party setup: `supabaseClient.js` (anon key only) |
| `utils/` | Small pure helpers: date formatting, diff helpers, text truncation |
| `constants/` | `roles.js` (owner / admin / worker / observer), `permissions.js`, `statuses.js` |
| `routes/` | Route list and `RoleGuard` (sends users to the right dashboard for their role) |
| `styles/` | `index.css` with Tailwind directives and global styles |

---

## `supabase/`: database

### `supabase/migrations/`
Numbered SQL files that build the schema, in order. Planned tables:
- `profiles`: users
- `projects`: project info, owner, observer code
- `project_members`: user + project + role (owner / admin / worker / observer)
- `admin_codes`, `join_requests`
- `agents`: each person's Builder + Critic
- `personal_history`: each person's own work log (deletable by its owner)
- `moderator_log`: final approved changes (permanent, never deleted)
- `intents`: live "who's working on what"
- `dependency_nodes`, `dependency_edges`: the dependency graph
- `proposals`, `merge_requests`, `review_buckets`, `reviews`
- `observer_requests`, `notifications`

### `supabase/policies/`
Row-level security rules, for example:
- an observer can only read *their* project, and only observer-safe data
- only admins can approve merges
- only the owner can create admins
- nobody can delete `moderator_log` rows
- only the owner of a history entry can delete it

### `supabase/seed/`
Sample data for development and the demo: one project, an owner, an admin, 2 workers, an observer, and some history.

---

## `docs/`

| Folder | Contents |
|---|---|
| `architecture/` | System design, roles and permissions, dependency graph rules, agent flows, diagrams |
| `api/` | Each endpoint: input, output, who can call it |
| `demo/` | Demo script for the 3–5 min video, reset steps |
| `submission/` | 500–600 word explanation, team info, Functional vs Simulated list |

---

## Other folders

| Folder | Contents |
|---|---|
| `public/` | Static files served as-is: favicon, social preview image |
| `scripts/` | Helper scripts: `seed.js`, `reset-demo.js` |
| `tests/unit/` | Tests for pure logic: dependency graph, overlap checks, bucketing, permissions |
| `tests/integration/` | Full flows: worker submits → admin approves → Moderator records → observer is notified |
| `tests/supabase/` | The same kind of flow against a real local Supabase, with only Claude faked (`npm run test:supabase`) |

---

## How a request flows through the folders

1. Worker clicks **Run Builder** → `src/pages/worker/` → `src/features/agents/` → `POST /api/agents/builder/run`
2. Builder asks the Moderator for context → `api/agents/moderator/context.js`
3. Builder declares its intent → `api/coordination/declare-intent.js` → `check-overlap.js`
4. Claude writes the change → `api/_lib/claude.js` → validated → saved as a proposal
5. Worker's Critic reviews it → `api/agents/critic/review.js`
6. Worker submits a merge request → `api/reviews/submit.js` → bucketed → prioritized by the Critic
7. Admin decides → `api/reviews/decide.js` → `merge-check.js`
8. On approval → `api/agents/moderator/record.js` updates the final log and the graph → `notify-dependents.js` alerts affected agents → `observer-summary.js` updates the observer view

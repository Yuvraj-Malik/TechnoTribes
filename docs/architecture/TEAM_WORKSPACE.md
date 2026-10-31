# Team workspace: Developer Workspace + Manager Review

Several departments of humans each work with their own AI agent on one shared project. Agents read a versioned shared context before acting, warn about conflicts, show a plan, and only change the developer's own copy of the project. Managers review, merge into main, and confirm how each change ripples through the context to other teams. Everything is logged.

## Set it up

1. Run the new migration: `npm run db:push` (or paste the end of `supabase/setup.sql` into the SQL editor). It adds `003_teams_context.sql`.
2. `npm run dev`, sign in, create a project (you are its owner).
3. On **Your projects** → **Open team workspace** → **Team setup** → **Set up CampusEats demo**.
4. Use the person picker in the top bar to act as a demo person (Rohan, Isha, Kabir, Ananya…). Only the owner can do this, and only for demo people.

Real members work the same way: on **Team setup** the owner puts each admin or worker into a department. **Manager** is the `admin` role and **Developer** is the `worker` role.

## Pages

| Route | Who | What |
|---|---|---|
| `/projects/:id/workspace` | developers | Context panel, work area (file tree, diff, plain summary, live preview), agent panel, submission bar |
| `/projects/:id/review` | managers (owner: any department) | Review queue, submission detail, approve / send back / reject, impact step, department overview |
| `/projects/:id/story` | everyone inside | Full activity log with old → new context values, main project history, real vs simulated |
| `/projects/:id/setup` | owner | Demo setup/reset, departments, member departments |

## How it works

- **Context** is split into sections, either `central` or per department (`context_sections`). Each section has a version, owner, tags and "agents watch for" guardrails, and every version is kept in `context_section_versions`. A task depends on the sections whose topic tags match it. Generic words like "endpoint" don't count, so unrelated changes don't disturb anyone.
- **Project files** live in `project_files`, so it runs on Vercel:
  - `main` is the shared project.
  - `<userId>` is a developer's isolated copy.
  - `base:<userId>` is the main snapshot that copy started from.
  - A submission stores exactly what changed. Approval does a 3-way, file-by-file merge into main, and a conflict is reported to the manager, never resolved silently. Each merge is recorded in `main_commits`.
- **Developer flow:** task → read context → conflict check (Go ahead / Change request / Cancel) → plan (Confirm / Edit) → edits in the developer's copy → diff, summary, preview, follow-ups → re-check → submit with a "why" and the context versions it was built on. Each agent step runs inside its request (`server/team-workspace.js`).
- **Manager flow** (`server/team-review.js`, `server/team-impact.js`): approve → merge → the agent proposes a context update → the system decides the impact:
  - It collects the words the change makes untrue (e.g. "card"). Any other section on the same topic that still says them is affected.
  - If a central section or another department's section is affected, the change is cross-department. Central updates first, then the other departments' sections.
  - Developers with active work on a changed section get a mid-task alert (Continue / Pause and adjust / Cancel). Pending submissions built on old versions show as Outdated.
  - The manager edits and confirms before anything changes.
- **Activity log** (`activity_log`): tasks, plans, warnings, choices, submissions, reviews, merges, context changes (old value, new value, version, why, who), impact decisions and notifications. Export it from the story page as JSON lines.
- **Agents** (`api/_lib/team-agent/`): live Claude through `api/_lib/claude.js` when `ANTHROPIC_API_KEY` is set, otherwise the simulated agent. The UI always shows which one is running.

## Demo scenario

1. **Rohan:** "Build the checkout page with a card payment form". Confirm the plan, then look at the diff and the live preview.
2. **Arjun:** "Add an order status endpoint". It doesn't depend on any payment sections.
3. **Isha:** "Switch from card payments to UPI only". Confirm and submit. **Kabir:** Approve and merge, look at the impact decision (cross-department, Arjun checked and not affected), then Confirm.
4. **Rohan** gets a "context changed" card. Choose **Pause and adjust**, then **Redo with new context**, then confirm the plan.
5. **Restart agent** (any developer) shows a "What I know" summary rebuilt from the context and the log.
6. **Ananya:** Meera's older "Remember the card on checkout" is marked Outdated. **Send back**, then approve Rohan's UPI checkout.
7. **Project story** shows the whole trail.

## Real vs simulated

| Part | Status |
|---|---|
| Sign-in, roles, departments, storage, notifications, activity log | Real |
| Per-developer copies, diffs, 3-way merge, merge-conflict detection | Real |
| Versioned context, relevance, guardrail checks, outdated detection, impact analysis | Real (deterministic rules) |
| Agent reasoning and edits | Live Claude with `ANTHROPIC_API_KEY`; otherwise simulated (scripted demo edits, a labelled TODO note for anything else) |
| The eight CampusEats demo people and the four days of history before the demo | Simulated |

## Tests

`npm run test:integration` runs the whole scenario through the real router and handlers against an in-memory Supabase stand-in (`tests/integration/fake-supabase.js`).

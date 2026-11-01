# API Reference

Every endpoint is served by one Vercel function (`api/index.js`); the table below is generated from its route list, so it matches the code. All endpoints except `GET /api/health` need `Authorization: Bearer <supabase access token>`. Project endpoints take `projectId` (query for GET, body for POST). `team/*` endpoints also accept the owner-only `x-act-as` header (demo people).

Roles: **owner** (created the project; codes, departments, roles), **admin** (manages one department: reviews and merges its work, assigns tasks), **worker** (developer with their own workspace and agent), **observer** (plain-language view, can request changes).

## Auth

| Method | Path | Handler |
|---|---|---|
| GET | `/api/auth/me` | `auth.me` |

## Projects, codes, members, brief

| Method | Path | Handler |
|---|---|---|
| POST | `/api/projects/create` | `projects.create` |
| GET | `/api/projects/get` | `projects.get` |
| POST | `/api/projects/observer-code` | `projects.regenerateObserverCode` |
| POST | `/api/projects/admin-code` | `projects.createAdminCode` |
| POST | `/api/projects/join` | `projects.join` |
| POST | `/api/projects/admins/approve` | `projects.approveAdmin` |
| POST | `/api/projects/join-request` | `projects.requestToJoin` |
| POST | `/api/projects/join-request/respond` | `projects.respondJoinRequest` |
| POST | `/api/projects/join-request/cancel` | `projects.cancelJoinRequest` |
| GET | `/api/projects/discover` | `projects.discover` |
| POST | `/api/projects/enter` | `projects.enter` |
| GET | `/api/projects/my-requests` | `projects.myRequests` |
| POST | `/api/projects/members/add` | `projects.addWorker` |
| GET | `/api/projects/members` | `projects.members` |
| POST | `/api/projects/update` | `projects.update` |
| POST | `/api/projects/project-code` | `projects.regenerateProjectCode` |
| POST | `/api/projects/members/remove` | `projects.removeMember` |

## Tasks

| Method | Path | Handler |
|---|---|---|
| GET | `/api/tasks/list` | `tasks.list` |
| POST | `/api/tasks/assign` | `tasks.assign` |
| POST | `/api/tasks/status` | `tasks.setStatus` |
| POST | `/api/tasks/delete` | `tasks.remove` |

## Observer

| Method | Path | Handler |
|---|---|---|
| GET | `/api/observer/feed` | `observer.feed` |
| POST | `/api/observer/request` | `observer.createRequest` |
| GET | `/api/observer/requests` | `observer.listRequests` |
| POST | `/api/observer/request/respond` | `observer.respond` |

## Notifications

| Method | Path | Handler |
|---|---|---|
| GET | `/api/notifications/list` | `notifications.list` |
| POST | `/api/notifications/read` | `notifications.markRead` |

## GitHub (optional)

| Method | Path | Handler |
|---|---|---|
| GET | `/api/github/tree` | `github.tree` |
| GET | `/api/github/file` | `github.file` |
| POST | `/api/github/import` | `github.importRepo` |
| POST | `/api/github/branch` | `github.branch` |
| POST | `/api/github/pull-request` | `github.pullRequest` |

## Team workspace: departments, versioned context, developer agents, manager review

| Method | Path | Handler |
|---|---|---|
| GET | `/api/team/bootstrap` | `team.bootstrap` |
| GET | `/api/team/context` | `team.context` |
| POST | `/api/team/context/seen` | `team.contextSeen` |
| GET | `/api/team/context/history` | `team.contextHistory` |
| GET | `/api/team/log` | `team.log` |
| GET | `/api/team/log/export` | `team.logExport` |
| GET | `/api/team/commits` | `team.commits` |
| GET | `/api/team/notifications` | `team.notifications` |
| POST | `/api/team/notifications/read` | `team.notificationsRead` |
| POST | `/api/team/members/department` | `team.setMemberDepartment` |
| POST | `/api/team/demo/setup` | `team.demoSetup` |
| GET | `/api/team/overview` | `teamOverview.overview` |
| GET | `/api/team/my/submissions` | `teamOverview.mySubmissions` |
| GET | `/api/team/my/assignments` | `teamOverview.myAssignments` |
| POST | `/api/team/departments/create` | `teamOverview.createDepartment` |
| POST | `/api/team/departments/update` | `teamOverview.updateDepartment` |
| POST | `/api/team/departments/delete` | `teamOverview.deleteDepartment` |
| POST | `/api/team/members/role` | `teamOverview.setRole` |
| POST | `/api/team/context/preview` | `teamContext.preview` |
| POST | `/api/team/context/save` | `teamContext.save` |
| POST | `/api/team/context/create` | `teamContext.create` |
| GET | `/api/team/task/current` | `teamWork.current` |
| POST | `/api/team/task/start` | `teamWork.start` |
| POST | `/api/team/task/conflict-decision` | `teamWork.conflictDecision` |
| POST | `/api/team/task/plan-decision` | `teamWork.planDecision` |
| POST | `/api/team/task/follow-up` | `teamWork.followUp` |
| POST | `/api/team/task/retry` | `teamWork.retry` |
| POST | `/api/team/task/cancel` | `teamWork.cancel` |
| POST | `/api/team/task/submit` | `teamWork.submit` |
| POST | `/api/team/task/context-decision` | `teamWork.contextDecision` |
| POST | `/api/team/task/rework` | `teamWork.rework` |
| POST | `/api/team/task/critic` | `teamWork.critic` |
| POST | `/api/team/agent/restart` | `teamWork.restartAgent` |
| GET | `/api/team/messages` | `teamOwner.listMessages` |
| POST | `/api/team/messages/send` | `teamOwner.sendMessage` |
| POST | `/api/team/members/designation` | `teamOwner.setDesignation` |
| GET | `/api/team/code` | `teamOwner.code` |
| GET | `/api/team/workspace/files` | `teamWork.files` |
| GET | `/api/team/workspace/file` | `teamWork.file` |
| GET | `/api/team/workspace/bundle` | `teamWork.bundle` |
| GET | `/api/team/workspace/diff` | `teamWork.diff` |
| GET | `/api/team/review/queue` | `teamReview.queue` |
| GET | `/api/team/review/detail` | `teamReview.detail` |
| POST | `/api/team/review/decide` | `teamReview.decide` |
| GET | `/api/team/review/overview` | `teamReview.overview` |
| POST | `/api/team/proposals/preview` | `teamImpact.preview` |
| POST | `/api/team/proposals/confirm` | `teamImpact.confirm` |
| POST | `/api/team/proposals/discard` | `teamImpact.discard` |

## How the pieces connect

- **Assigned tasks follow agent work.** `tasks/assign` creates a task; the worker starts it in their workspace (`team/task/start` with `assignmentId`). Its status then moves by itself: started → in_progress, submitted → in_review, approved → done, sent back / rejected → in_progress. A task made from an observer request marks that request done and notifies the observer on approval.
- **Agents know about each other.** When an agent plans, it compares its files with every other active task and warns both developers (`agent.overlap_warning`); the overlap shows on `team/overview`.
- **Context is versioned.** `team/context/preview` shows who an edit affects; `team/context/save` needs a reason per edit, bumps versions, alerts developers whose active work depends on it, and marks pending submissions built on the old version as outdated.
- **One source of truth.** Approved files live in `project_files` workspace `main`, with history in `main_commits`. Each developer has their own copy (`<userId>`) and base (`base:<userId>`); approval is a 3-way merge into main.
- **Every admin and worker has a department** (a "General" one is created with each project), so every worker always has a workspace.

### Suggestions and checkpoints (coordination layer)

Agents and people never edit shared context directly: they create a **suggestion**, and plain code routes it (`api/_lib/suggestions.js`) from facts about the change:

| Route | When | Who decides |
|---|---|---|
| `blocked` | outside the suggester's department | nobody; logged as `permission.blocked` |
| `sent_back` | based on a version that has since changed | the agent re-checks |
| `applied` (path 1) | progress only, own department, no rule hit, within the split-guard limits | applied directly and logged |
| `pending_manager` · `plan_change` (path 2) | changes the department plan | department manager: approve / reject |
| `pending_manager` · `conflict` (path 3) | breaks a department rule (guardrail) | department manager: approve / reject |
| `pending_manager` → `pending_founder` (path 4) | touches or conflicts with central | manager first: workaround / escalate / reject; then founder: approve / reject |
| `pending_manager` · `large_change` | more than 3 notes or 5 files per task, or more than 3 direct notes by one agent in 24 h | department manager |

Rejections, workarounds and escalations need a reason; it is sent to the suggester and stored on their task (`task.feedback`).

| Method | Endpoint | Who | Body / query | Returns |
|---|---|---|---|---|
| POST | `/api/team/suggestions/create` | insiders | `{ scope, changes: [{ op: add/update/remove, itemId?, kind?, title?, content? }], why, basedOn?, taskId?, files? }` | the routed suggestion |
| POST | `/api/team/suggestions/decide` | manager / founder | `{ suggestionId, action, reason? }` | the suggestion |
| GET | `/api/team/suggestions/queue` | manager / founder | | items they decide, with `dependents` (tasks and suggestions built on the same items) |
| GET | `/api/team/suggestions/mine` | insiders | `taskId?` | the acting person's suggestions |
| GET | `/api/team/suggestions/get` | suggester / managers | `suggestionId` | one suggestion with `dependents`, `canDecide` |
| POST | `/api/team/checkpoints/flag` | department manager | `{ title, content, links: [progress item ids] }` | a checkpoint suggestion for the founder |

### Agents: version checks, reviewer, orchestrator

- **Every agent step** (plan, edit, follow-up) first compares the context versions the task was built on with the current ones (one query when nothing changed). A changed item the task uses pauses it with the "context changed" card; other changes are only noted. "Continue as is" acknowledges those versions.
- **Reviewer** (`review` on the team agent; live: `CLAUDE_ROUTINE_MODEL`, default `claude-haiku-5-5`): runs only on suggestions that would apply directly. It can add flags (→ department manager, or the central path if it flags a central item); if it fails or is unsure the suggestion goes to a person with the label `unchecked`.
- **Orchestrator** (`orchestrate`): turns a goal into draft tasks (`tasks.source = 'orchestrator'`, no assignee) that the department manager assigns.

| Method | Endpoint | Who | Body / query | Returns |
|---|---|---|---|---|
| POST | `/api/team/goals/plan` | founder (any department) / manager (own) | `{ goal }` | `{ tasks }` drafts |
| GET | `/api/team/goals/drafts` | founder / manager | | unassigned drafts |
| POST | `/api/team/goals/assign` | that department's manager / founder | `{ taskId, assigneeId }` | the assigned task |

### Claims, requests between departments, and end-of-task summaries

- **File claims:** confirming a plan claims its files (in the department's area). Until that work is submitted, approved or cancelled, other agents' edits to those files are not written and are logged as `permission.blocked` (`data.reason = 'claimed'`).
- **Requests:** short asks (title ≤ 120, details ≤ 600 characters) to another department. A request is a draft task there (`tasks.source = 'request'`); its manager assigns it (`team/goals/assign`) or declines it with a reason. When the work is approved, the result is written back to the request, the requester is notified, and their task gets a message.
- **Summary:** when the agent finishes, `task.summaryDraft` holds the structured summary (what changed, files from the diff, new files others can rely on, decisions and why, what is open, what other departments must do, derived from what was blocked). The developer edits the words and shares it.

| Method | Endpoint | Who | Body / query | Returns |
|---|---|---|---|---|
| POST | `/api/team/task/share` | developer | `{ taskId, summary }` | `{ suggestion, requests, summary }`: files re-checked against the diff; ticked needs become requests |
| POST | `/api/team/requests/create` | developer / manager | `{ toDepartment, title, body, fromTaskId? }` | the request |
| GET | `/api/team/requests/list` | insiders | | `{ incoming, outgoing }` for the acting person's department |
| POST | `/api/team/requests/decline` | receiving manager | `{ requestId, reason }` | the request |

### Safety net: revert, search, drift check, irreversible actions

- **Revert context:** writes an earlier version's content back as a **new** version, through the change router (so the founder reverts central, a manager their department). The preview lists what depends on the newer versions first (later versions, tasks built on them, waiting submissions, checkpoints).
- **Undo a merge:** creates an "undo" submission (the reverse change) in the review queue; approving it merges like any change, and if later merges touched the same lines it stops with a conflict for a person. No context proposal follows an undo.
- **Developers** can undo their own agent's unshared changes (`team/task/undo-edits`); everything shared is reverted by its approver.
- **Irreversible actions:** if an agent's edits would delete a file, delete data (`drop table`, `truncate`, `delete from`), change deployment, or message real users, nothing is written: the task waits in `needs_action_approval` with the reasons and the exact diff until the developer approves or rejects.
- **Search** covers context versions, suggestions (rejected ones with their reasons) and key log entries. By meaning with `VOYAGE_API_KEY` (embeddings cached in `search_embeddings`), otherwise by keywords; `mode` says which ran. Agents get the top related notes when they read the context.
- **Drift check** (plain code): rules broken in the main project's files, department plans contradicting central, progress mentioning obsolete things, workarounds piling up. On demand, and daily via Vercel Cron (`CRON_SECRET`).

| Method | Endpoint | Who | Body / query | Returns |
|---|---|---|---|---|
| GET | `/api/team/revert/preview` | insiders | `itemId, toVersion` | `{ item, target, dependents, canRevert }` |
| POST | `/api/team/revert/context` | founder (central) / manager (own) | `{ itemId, toVersion, reason }` | `{ suggestion, dependents }` |
| GET | `/api/team/revert/merge-preview` | insiders | `submissionId` | `{ submission, laterMerges, canRevert }` |
| POST | `/api/team/revert/merge` | department manager / founder | `{ submissionId, reason }` | the undo submission |
| POST | `/api/team/task/undo-edits` | developer | `{ taskId }` | the task |
| POST | `/api/team/task/action-decision` | developer | `{ taskId, choice: approve/reject }` | the task |
| GET | `/api/team/search` | insiders | `q, limit?` | `{ mode, results }` |
| POST | `/api/team/drift/run` | founder / manager | | `{ findings, headline, ranAt }` |
| GET | `/api/team/drift/latest` | insiders | | `{ run }` |
| GET | `/api/team/drift/cron` | Vercel Cron (`Authorization: Bearer $CRON_SECRET`) | | `{ ran }` |

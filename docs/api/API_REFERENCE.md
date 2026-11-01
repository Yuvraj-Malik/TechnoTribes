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

`observer/feed` is plain language only. `api/_lib/observer-summary.js` builds `roadmap` (every piece of work: assigned tasks, work given straight to an agent, and anything else on the live site), `people` (who is doing what, and their next step), `update` (the last day in sentences), `line` (versions and side tracks) and `map` (the site's parts). File paths and agent statuses never leave that file. Only `currentSite` carries files, for the live preview.

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
| POST | `/api/team/agent/restart` | `teamWork.restartAgent` |
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

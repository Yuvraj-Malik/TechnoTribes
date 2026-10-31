# API Reference

Every endpoint lives under `/api/...`. All except `GET /api/health` need the Supabase session token:

```
Authorization: Bearer <supabase access_token>
Content-Type: application/json
```

Errors always come back as `{ "error": "plain message", "details": {...} }` with these status codes:
`400` bad input · `401` not signed in · `403` wrong role · `404` not found · `409` conflict / overlap / already done · `422` agent context incomplete · `502/504` Claude problem.

**Roles:** `owner` (created the project) · `admin` · `worker` · `observer`. "Managers" = owner + admin. "Engineers" = owner + admin + worker (they have their own Builder + Critic). "Insiders" = owner + admin + worker.

---

## Team split: who owns what

| Person | Area | Files |
|---|---|---|
| **1. Platform** | Auth, projects, codes, members, brief, tasks, notifications, history | `server/auth.js`, `server/projects.js`, `server/tasks.js`, `server/notifications.js`, `server/history.js` |
| **2. Agents** | Builder + Critic agents, Claude client, prompts | `server/agents/builder.js`, `server/agents/critic.js`, `api/_lib/claude.js` |
| **3. Moderator + Coordination** | Context packet, permanent log, dependency graph, overlap checks, staleness | `server/moderator.js`, `server/coordination.js`, `api/_lib/moderator.js`, `api/_lib/coordination.js`, `api/_lib/dependency-graph.js` |
| **4. Reviews + Observer + GitHub** | Merge requests, bucketing, decisions, observer feed/requests, GitHub | `server/reviews.js`, `server/observer.js`, `server/github.js`, `api/_lib/reviews.js` |

Shared (change carefully, tell the team): `api/index.js` (router), `api/_lib/http.js`, `permissions.js`, `errors.js`, `supabase-admin.js`, `paths.js`, `log.js`, and the database schema.

**Adding an endpoint:** write the handler in `server/` as `export async function name({ user, body, query })`, return a plain object, throw `HttpError` for errors, then add one line to the `routes` table in `api/index.js`.

---

## 1. Platform

| Method | Endpoint | Who | Body / query | Returns |
|---|---|---|---|---|
| GET | `/api/health` | anyone | | `{ ok }` |
| GET | `/api/auth/me` | signed in | | `{ user, projects: [{projectId, role, status, name}] }` |
| POST | `/api/projects/create` | signed in | `{ name, description?, brief?, repo?: {owner, name, branch} }` | `{ project, observerCode }`. Creator becomes owner |
| POST | `/api/projects/update` | owner | `{ projectId, name?, description?, repo?: {owner, name, branch} }` | `{ project }` |
| GET | `/api/projects/get` | everyone | `?projectId` | `{ project, role }` (observer code only for owner) |
| POST | `/api/projects/observer-code` | owner | `{ projectId }` | `{ observerCode }`. Old code stops working |
| POST | `/api/projects/admin-code` | owner | `{ projectId, expiresInDays? }` | `{ code, expiresAt }` |
| POST | `/api/projects/join` | signed in | `{ code }` | `OBS-` → observer · `ADM-` → admin pending owner approval |
| POST | `/api/projects/admins/approve` | owner | `{ projectId, userId, approve }` | `{ approved }`. Creates their Builder + Critic |
| POST | `/api/projects/join-request` | signed in | `{ projectId, message? }` | `{ request }`. Managers notified |
| POST | `/api/projects/join-request/respond` | managers | `{ requestId, accept }` | `{ accepted }` |
| POST | `/api/projects/members/add` | managers | `{ projectId, email }` | adds a worker directly |
| POST | `/api/projects/members/update` | managers | `{ projectId, userId, designation?, team?, leadId? }` | `team` is for admins, `leadId` (the admin they report to) is for workers |
| GET | `/api/projects/members` | insiders | `?projectId` | `{ members (with agents, team, lead_id, designation), joinRequests }` |
| POST | `/api/projects/brief/preview` | managers | `{ projectId, brief }` | `{ changedFields, impact }`. **What would this affect?** (nothing saved) |
| POST | `/api/projects/brief` | managers | `{ projectId, brief, reason? }` | `{ version, impact }`. New version, dependent work marked stale |
| GET | `/api/tasks/list` | insiders | `?projectId&mine=true` | `{ tasks }` |
| POST | `/api/tasks/assign` | managers | `{ projectId, assigneeId, title, description?, targets?: [paths], observerRequestId? }` | `{ task }`. Accepts an observer request when `observerRequestId` is set |
| POST | `/api/tasks/status` | assignee / managers | `{ taskId, status }` | |
| GET | `/api/notifications/list` | signed in | `?projectId&unread=true` | `{ notifications }` |
| POST | `/api/notifications/read` | signed in | `{ ids }` or `{ all: true }` | `{ updated }` |
| POST | `/api/messages/send` | owner | `{ projectId, to: "all" or userId, text }` | `{ message }`. Each admin it goes to is notified |
| GET | `/api/messages/list` | managers | `?projectId` | `{ messages }`. Owner sees all, an admin sees those sent to them |
| GET | `/api/history/list` | insiders | `?projectId&limit&before` | your own history only |
| POST | `/api/history/delete` | owner of entries | `{ ids }` | `{ deleted }` |

## 2. Agents

| Method | Endpoint | Who | Body | Returns |
|---|---|---|---|---|
| GET | `/api/agents/proposals` | engineers | `?projectId` | `{ proposals }`. Your own, newest first, each with its latest `review` |
| POST | `/api/agents/builder/run` | engineers | `{ projectId, instruction, targets?: [paths], taskId?, redirectFromMergeRequestId?, force? }` | `{ proposal, basedOnVersion, overlap }` |
| POST | `/api/agents/critic/review` | proposal author | `{ proposalId }` | `{ review: { verdict, score, summary, issues } }` |
| POST | `/api/agents/critic/prioritize` | managers | `{ projectId }` | `{ buckets }` ranked, with reason + recommendation |

**What `builder/run` does, in order:**
1. Gets the context packet from the Moderator.
2. **422** if a file the work depends on is missing (`details.missing`).
3. Checks other agents' active work. **409** if someone is already on the same files (`details.overlap`); send `force: true` to continue anyway. "Dependent" overlaps are returned as warnings and passed to Claude.
4. Declares an intent so other agents can see it.
5. Asks Claude, validates the JSON, saves a **draft** proposal stamped with `base_version`.

Nothing reaches the project until it is submitted and approved.

## 3. Moderator + Coordination

| Method | Endpoint | Who | Body / query | Returns |
|---|---|---|---|---|
| GET | `/api/moderator/context` | engineers | `?projectId&targets=a.jsx,b.jsx&taskId` | the full context packet (below) |
| GET | `/api/moderator/log` | insiders | `?projectId&limit&before` | permanent approved changes, newest first |
| GET | `/api/moderator/state` | insiders | `?projectId` | `{ version, brief, files }` |
| GET | `/api/moderator/graph` | insiders | `?projectId` | `{ nodes, edges }` for the graph view |
| POST | `/api/coordination/check` | engineers | `{ projectId, targets }` | `{ status: clear / dependent / same_target, conflicts, message }` |
| POST | `/api/coordination/declare` | engineers | `{ projectId, goal, targets, taskId?, force? }` | `{ intent, overlap }` |
| POST | `/api/coordination/release` | its owner / managers | `{ intentId }` | |
| GET | `/api/coordination/board` | insiders | `?projectId` | `{ work: who is doing what, agents }` |

**Context packet:** `version`, `brief`, `task`, `relevantFiles` (content of targets + what they depend on), `fileIndex`, `requiredDependencies`, `missing`, `complete`, `recentChanges` (last 20 approved), `activeWorkByOthers` (goals + targets only, never their code), `myRecentHistory`.

**Graph keys:** `file:src/pages/Pricing.jsx` for files, `req:audience` for brief fields. Edge `A → B` = "A depends on B". Edges are added when a merge is approved, using the Builder's `depends_on`.

## 4. Reviews + Observer + GitHub

| Method | Endpoint | Who | Body / query | Returns |
|---|---|---|---|---|
| POST | `/api/reviews/submit` | engineers | `{ projectId, proposalIds, note? }` | `{ mergeRequest }` with a full change list |
| POST | `/api/reviews/bucket` | managers | `{ projectId }` | `{ buckets }` regrouped |
| GET | `/api/reviews/queue` | managers | `?projectId` | `{ buckets (with requests, proposals, critic reviews), needsAttention }` |
| POST | `/api/reviews/decide` | managers | `{ projectId, decisions: [{ mergeRequestId, decision: approve / reject / redirect, note? }] }` | `{ results }` per request |
| GET | `/api/observer/feed` | everyone | `?projectId` | `{ whatChanged, happeningNow, nextSteps, currentSite, goals }` in plain language |
| POST | `/api/observer/request` | observer | `{ projectId, message }` | managers notified |
| GET | `/api/observer/requests` | managers / observer | `?projectId` | `{ requests }` |
| POST | `/api/observer/request/respond` | managers | `{ requestId, status: rejected / done, response? }` | to accept, assign a task instead |
| GET | `/api/github/tree` | insiders | `?projectId&ref` | repo file list |
| GET | `/api/github/file` | insiders | `?projectId&path&ref` | file content |
| POST | `/api/github/import` | managers | `{ projectId, ref?, paths? }` | imports repo files as a new version |
| POST | `/api/github/branch` | insiders | `{ projectId, name, from? }` | |
| POST | `/api/github/pull-request` | managers | `{ projectId, head, base?, title, body? }` | `{ number, url }` |

**Approve flow (`reviews/decide`):**
1. **Conflict check.** If anything the request touches or depends on changed since its `base_version`, it becomes `conflict` and the worker is told to re-run.
2. The Moderator commits the change as a new version and writes the permanent log with a plain-language summary.
3. Dependency edges are recorded and the intents are released.
4. Every unfinished proposal or request that depended on the changed files becomes `stale`, and its owner is notified.
5. Linked tasks and observer requests are closed. The observer gets the update.

Decisions run in order, so approving two clashing requests from one bucket approves the first and flags the second.

---

## Status values

- **Proposal:** draft → reviewed → submitted → approved / rejected / redirected, or **stale** at any point before approval
- **Merge request:** pending → approved / rejected / redirected / **conflict** / **stale**
- **Task:** open → in_progress → in_review → done
- **Observer request:** pending → accepted → done, or rejected

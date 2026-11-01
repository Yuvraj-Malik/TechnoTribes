// Turns the team's work into plain language for the observer: how much is done,
// by whom, what is left and what happens next. File paths and agent statuses
// stop here, so nothing technical reaches the page. No database code here, so
// tests/unit can check these rules directly.

const STAGE = { open: 'upcoming', in_progress: 'now', in_review: 'now', done: 'done' };
const STAGE_ORDER = { done: 0, now: 1, upcoming: 2 };
const OPEN = ['reading_context', 'checking_conflicts', 'needs_conflict_decision', 'planning', 'awaiting_plan_approval', 'working', 'done', 'needs_context_decision', 'sent_back', 'failed'];
const DAY_MS = 24 * 3600e3;
const FEW = 3;

const firstName = (name) => String(name || 'Someone').trim().split(/\s+/)[0];
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const filesOf = (d) => [...new Set([...(d.plan?.files ?? []), ...(d.changedFiles ?? [])])];

// step: how far along the side track it is (0 planning, 1 building, 2 checking, 3 approving).
// next: what the person has to do. Without it the work is with the AI agent.
const BY_AGENT = {
  reading_context: { step: 0, words: () => 'AI agent is planning it.' },
  checking_conflicts: { step: 0, words: () => 'AI agent is planning it.' },
  planning: { step: 0, words: () => 'AI agent is planning it.' },
  working: { step: 1, words: () => 'AI agent is building it.' },
  needs_conflict_decision: { step: 0, words: (me) => `${me} needs to decide about a clash with the rules.`, next: (t) => `Decide about a clash with the rules in "${t}"` },
  awaiting_plan_approval: { step: 0, words: (me) => `Plan ready. ${me} needs to OK it.`, next: (t) => `OK the plan for "${t}"` },
  needs_context_decision: { step: 1, words: (me) => `A rule changed. ${me} is deciding how to continue.`, next: (t) => `Decide how to continue "${t}" after a rule changed` },
  failed: { step: 1, words: (me) => `The AI agent hit a problem. ${me} is looking at it.`, next: (t) => `Sort out the problem with "${t}"` },
  sent_back: { step: 1, words: (me) => `Sent back for changes. ${me} is reworking it.`, next: (t) => `Rework "${t}"` },
  done: { step: 2, words: (me) => `AI agent finished. ${me} is checking it.`, next: (t) => `Check "${t}" and send it for approval` },
};

/** The person who approves a department's work: its manager, or the owner when it has none. */
export function reviewerOf(department, departments = [], people = []) {
  const managerId = departments.find((d) => d.id === department)?.managerId;
  return people.find((p) => p.id === managerId) ?? people.find((p) => p.role === 'owner') ?? null;
}

/** Where a piece being worked on stands, and whose turn it is. */
function standing(d, title, sub, reviewer) {
  const since = d.updatedAt ?? d.createdAt;
  if (d.status === 'submitted') {
    const name = reviewer ? firstName(reviewer.name) : 'A manager';
    const clash = sub?.status === 'merge_conflict';
    return {
      step: 3,
      statusWords: clash ? `Built. ${name} is sorting out a clash with newer work.` : `Built. Waiting for ${name} to approve.`,
      waitingOn: reviewer && { userId: reviewer.id, words: clash ? `Sort out a clash in "${title}"` : `Approve "${title}"`, since: sub?.createdAt ?? since },
    };
  }
  const known = BY_AGENT[d.status];
  if (!known) return null;
  return {
    step: known.step,
    statusWords: known.words(firstName(d.userName)),
    waitingOn: known.next ? { userId: d.userId, words: known.next(title), since } : null,
  };
}

const firstSentence = (text) => clip(String(text || 'A piece of work').split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, ''), 80);
export const messageTitle = (message) => String(message).replace(/^.*?'s "|"$/g, '');

// Agents write their summaries freely and sometimes name files. A bare "Node.js" is not a file.
const FILE_IN_TEXT = /(?:[\w-]+\/)*[\w.-]+\.(?:html?|css|sql)\b|(?:[\w-]+\/)+[\w.-]+\.(?:jsx?|tsx?|json|md)\b/g;
export const plainText = (text) => (text ? text.replace(FILE_IN_TEXT, (path) => partName(path)) : null);

/**
 * Every piece of work, finished or not. An assigned task is one piece, and so is
 * work a person gave their agent directly: only counting tasks would miss it.
 * Anything else that reached the live site is a finished piece too, so every
 * version on the project line is also a brick on the wall.
 */
export function buildWork({ tasks = [], devs = [], submissions = [], commits = [], people = [], departments = [], requests = [], viewerId = null, nameOf = () => 'Someone' }) {
  const history = [...commits].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const latestSub = (devId) => submissions.filter((s) => s.taskId === devId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] ?? null;
  const versionOf = (sub) => {
    if (!sub) return null;
    const match = history.findIndex((c) => String(c.message).includes(sub.title));
    if (match >= 0) return match + 1;
    return history.filter((c) => String(c.created_at) <= String(sub.reviewedAt ?? sub.createdAt)).length || null;
  };
  const wordsFor = (stage, version, now, status) => {
    if (stage === 'done') return version ? `Live since version ${version}.` : 'Finished and live.';
    if (stage === 'upcoming') return 'Not started.';
    return now?.statusWords ?? (status === 'in_review' ? 'Built. Waiting for a manager to approve.' : 'Being built right now.');
  };

  const assigned = tasks.map((t) => {
    const d = devs.find((x) => x.id === t.dev_task_id) ?? null;
    const sub = d ? latestSub(d.id) : null;
    const stage = STAGE[t.status] ?? 'upcoming';
    const now = stage === 'now' && d ? standing(d, t.title, sub, reviewerOf(d.department, departments, people)) : null;
    const version = stage === 'done' ? versionOf(sub) : null;
    return {
      id: t.id, devTaskId: d?.id ?? null, title: t.title, details: t.description, who: nameOf(t.assignee_id), userId: t.assignee_id,
      stage, step: now?.step ?? 0, statusWords: wordsFor(stage, version, now, t.status), waitingOn: now?.waitingOn ?? null, version,
      what: plainText(sub?.summary || d?.summary), why: plainText(sub?.why || d?.whyDraft),
      fromYourRequest: !!t.observer_request_id && requests.some((r) => r.id === t.observer_request_id && r.observer_id === viewerId),
      fromRequest: !!t.observer_request_id,
      when: sub?.reviewedAt || sub?.createdAt || t.created_at,
    };
  });

  const taskIds = new Set(tasks.map((t) => t.id));
  const linked = new Set(tasks.map((t) => t.dev_task_id).filter(Boolean));
  const direct = devs
    .filter((d) => !linked.has(d.id) && !taskIds.has(d.assignmentId) && (d.status === 'approved' || d.status === 'submitted' || OPEN.includes(d.status)))
    .map((d) => {
      const sub = latestSub(d.id);
      const title = sub?.title || firstSentence(d.text);
      const stage = d.status === 'approved' ? 'done' : 'now';
      const now = stage === 'now' ? standing(d, title, sub, reviewerOf(d.department, departments, people)) : null;
      const version = stage === 'done' ? versionOf(sub) : null;
      return {
        id: d.id, devTaskId: d.id, title, details: null, who: d.userName || nameOf(d.userId), userId: d.userId,
        stage, step: now?.step ?? 0, statusWords: wordsFor(stage, version, now), waitingOn: now?.waitingOn ?? null, version,
        what: plainText(sub?.summary || d.summary), why: plainText(sub?.why || d.whyDraft),
        fromYourRequest: false, fromRequest: false,
        when: sub?.reviewedAt || sub?.createdAt || d.createdAt,
      };
    });

  const credited = new Set([...assigned, ...direct].map((w) => w.version));
  const unclaimed = history.flatMap((c, i) => (credited.has(i + 1) ? [] : [{
    id: c.id, devTaskId: null, title: messageTitle(c.message), details: null, who: nameOf(c.author_id), userId: c.author_id,
    stage: 'done', step: 0, statusWords: wordsFor('done', i + 1), waitingOn: null, version: i + 1,
    what: null, why: null, fromYourRequest: false, fromRequest: false, when: c.created_at,
  }]));

  return [...assigned, ...direct, ...unclaimed].sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]
    || (a.stage === 'now' ? b.step - a.step : 0)
    || String(a.when).localeCompare(String(b.when)));
}

/** Plain name for a project file. */
export function partName(path) {
  const base = path.split('/').pop().replace(/\.[^.]+$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').trim().toLowerCase();
  const title = base.charAt(0).toUpperCase() + base.slice(1);
  if (/\.html?$/i.test(path)) return base === 'index' ? 'Home page' : `${title} page`;
  if (/\.css$/i.test(path)) return ['styles', 'style', 'main', 'global', 'globals', 'app'].includes(base) ? 'Look and feel' : `${title} look and feel`;
  if (/\.[jt]sx?$/i.test(path)) return ['app', 'main', 'index', 'script', 'scripts'].includes(base) ? 'Buttons and actions' : `${title} actions`;
  return title;
}

const isPage = (path) => /\.html?$/i.test(path);

/** Two people's agents warned each other about the same files, and both are still working. */
export function findOverlaps(devs = []) {
  const open = devs.filter((d) => d.status === 'submitted' || OPEN.includes(d.status));
  const seen = new Set();
  return open.flatMap((d) => (d.peers ?? []).flatMap((p) => {
    const key = [d.id, p.taskId].sort().join('|');
    if (seen.has(key) || !open.some((o) => o.id === p.taskId)) return [];
    seen.add(key);
    const file = [...(p.files ?? [])].sort((a, b) => isPage(b) - isPage(a))[0];
    return [{ devTaskIds: [d.id, p.taskId], names: [firstName(d.userName), firstName(p.name)], part: file ? partName(file) : 'same part' }];
  }));
}

const overlapWords = ({ names, part }) => `${names[0]} and ${names[1]} are both changing the ${part}. Their AI agents warned them, so they can avoid clashing.`;

const ROLE_TITLE = { owner: 'Project owner', admin: 'manager', worker: 'developer' };
const ROLE_ORDER = { owner: 0, admin: 1, worker: 2 };

/** One row per person: their pieces of work and what they do next. */
export function teamProgress({ people = [], departments = [], work = [], events = [], requests = [], viewerId = null }) {
  const pending = requests.filter((r) => r.status === 'pending');
  const decideWords = pending.length > 1 ? `Decide on ${pending.length} requests` : pending[0]?.observer_id === viewerId ? 'Decide on your request' : 'Decide on a request from the investor';
  return people
    .filter((p) => p.role !== 'observer')
    .map((p) => {
      const pieces = work.filter((w) => w.userId === p.id);
      const waiting = work.map((w) => w.waitingOn).filter((w) => w?.userId === p.id).sort((a, b) => String(a.since).localeCompare(String(b.since)));
      const department = departments.find((d) => d.id === p.department)?.name;
      const rules = events.filter((e) => e.actor_id === p.id).length;
      const decide = p.role === 'owner' && pending.length ? { words: decideWords, since: pending.at(-1).created_at } : null;
      return {
        userId: p.id, name: p.name,
        title: p.designation || (p.role === 'owner' ? ROLE_TITLE.owner : `${department ?? 'Team'} ${ROLE_TITLE[p.role]}`),
        pieces: pieces.map(({ id, title, stage }) => ({ id, title, stage })),
        next: waiting[0] ? { words: waiting[0].words, since: waiting[0].since } : decide,
        rules, role: p.role,
      };
    })
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name))
    .map(({ role: _role, ...row }) => row);
}

/** The last day in plain words. Written from the data, so it works without a live agent. */
export function plainUpdate({ work = [], requests = [], overlaps = [], viewerId = null, now = Date.now() }) {
  const done = work.filter((w) => w.stage === 'done').sort((a, b) => String(b.when).localeCompare(String(a.when)));
  const recent = done.filter((w) => now - new Date(w.when).getTime() < DAY_MS);
  const line = (w, words) => ({ id: w.id, title: w.title, words });
  const asked = requests.filter((r) => r.status === 'pending' && r.observer_id === viewerId);
  return {
    finished: (recent.length ? recent : done.slice(0, 1)).slice(0, FEW)
      .map((w) => line(w, `${firstName(w.who)} finished it${w.fromYourRequest ? ', as you asked' : ''}.`)),
    now: work.filter((w) => w.stage === 'now').slice(0, FEW).map((w) => line(w, w.statusWords)),
    next: [
      ...work.filter((w) => w.stage === 'upcoming').slice(0, 2).map((w) => line(w, `${firstName(w.who)} is next.`)),
      ...asked.slice(0, 1).map((r) => ({ id: r.id, title: 'Your request', words: `"${clip(r.message, 60)}" is waiting for a decision.` })),
    ],
    notes: overlaps.map(overlapWords),
  };
}

/** The history of the live site, with the work happening beside it. */
export function projectLine({ commits = [], work = [], overlaps = [], nameOf = () => 'Someone' }) {
  const piece = (devTaskId) => work.find((w) => w.devTaskId === devTaskId)?.id;
  const versions = [...commits]
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((c, i) => {
      const w = work.find((x) => x.version === i + 1);
      return { version: i + 1, title: w?.title ?? messageTitle(c.message), who: w?.who ?? nameOf(c.author_id), userId: w?.userId ?? c.author_id, when: c.created_at };
    });
  const pick = ({ id, title, who, userId, step, statusWords }) => ({ id, title, who, userId, step, statusWords });
  return {
    versions,
    tracks: work.filter((w) => w.stage === 'now').map(pick),
    planned: work.filter((w) => w.stage === 'upcoming').map(pick),
    overlaps: overlaps.map((o) => ({ pieces: o.devTaskIds.map(piece), part: o.part })),
  };
}

// The files a page links to: its look, its scripts and other pages.
const LINKS = /\b(?:src|href)=["']([^"'#?]+)/g;

function linksOf(path, content, paths) {
  const folder = path.split('/').slice(0, -1);
  return [...new Set([...String(content).matchAll(LINKS)].map(([, link]) => {
    if (/^([a-z]+:|\/\/)/i.test(link)) return null;
    const parts = link.startsWith('/') ? [] : [...folder];
    for (const part of link.split('/')) {
      if (part === '..') parts.pop();
      else if (part && part !== '.') parts.push(part);
    }
    return parts.join('/');
  }))].filter((target) => target && target !== path && paths.includes(target));
}

/** The product as parts instead of files: its pages, what they share, and who is changing each one. */
export function productMap({ files = {}, devs = [], work = [] }) {
  const paths = Object.keys(files);
  const open = devs.filter((d) => d.status === 'submitted' || OPEN.includes(d.status));
  const homeFirst = (a, b) => (partName(b) === 'Home page') - (partName(a) === 'Home page') || a.localeCompare(b);
  const adding = [...new Set(open.flatMap(filesOf))].filter((p) => isPage(p) && !paths.includes(p));
  const pages = [...paths.filter(isPage), ...adding].sort(homeFirst);
  const uses = pages.map((page) => ({ page, targets: linksOf(page, files[page] ?? '', paths) }));
  const shared = [...new Set(uses.flatMap((u) => u.targets).filter((t) => !isPage(t)))].sort((a, b) => a.localeCompare(b));
  const idOf = (path) => `part-${[...pages, ...shared].indexOf(path)}`;
  const part = (path, kind) => ({
    id: idOf(path), name: partName(path), kind, isNew: adding.includes(path),
    people: [...new Set(open.filter((d) => filesOf(d).includes(path)).map((d) => firstName(d.userName)))],
  });
  return {
    parts: [...pages.map((p) => part(p, 'page')), ...shared.map((p) => part(p, 'shared'))],
    links: uses.flatMap(({ page, targets }) => targets.filter((t) => !isPage(t)).map((t) => ({ from: idOf(page), to: idOf(t) }))),
    planned: work.filter((w) => w.stage === 'upcoming').map(({ id, title, who }) => ({ id, title, who: firstName(who) })),
    hidden: paths.length - paths.filter(isPage).length - shared.length,
  };
}

/** Everything the observer's progress views need. */
export function summarize({ tasks, devs, submissions, commits, people, departments, requests, events, files, viewerId, nameOf, now }) {
  const work = buildWork({ tasks, devs, submissions, commits, people, departments, requests, viewerId, nameOf });
  const overlaps = findOverlaps(devs);
  const counts = { done: 0, now: 0, upcoming: 0 };
  for (const w of work) counts[w.stage] += 1;
  return {
    work,
    counts,
    people: teamProgress({ people, departments, work, events, requests, viewerId }),
    update: plainUpdate({ work, requests, overlaps, viewerId, now }),
    line: projectLine({ commits, work, overlaps, nameOf }),
    map: productMap({ files, devs, work }),
  };
}

// Central and department context: versioned sections, relevance, staleness.
import { db, q } from './supabase-admin.js';
import { logEvent } from './activity.js';

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'our', 'add', 'make', 'build', 'page', 'new', 'use']);
/** Words too generic to make a section relevant on their own ("endpoint" alone says nothing about payments). */
const GENERIC_TAGS = new Set(['api', 'endpoint', 'contract', 'route', 'page', 'form', 'method', 'table', 'feature']);

export function tokens(text) {
  return [...new Set(String(text).toLowerCase().match(/[a-z][a-z0-9]+/g) ?? [])].filter((w) => w.length >= 3 && !STOP.has(w));
}

function tagMatches(tag, word) {
  return word === tag || word.startsWith(tag) || (tag.length >= 4 && tag.startsWith(word) && word.length >= 4);
}

/** Which of these terms does the text mention (loosely: "cards" matches "card")? */
export function mentions(text, terms) {
  const words = tokens(text);
  return terms.filter((t) => words.some((w) => tagMatches(String(t).toLowerCase(), w)));
}

export const scopeLabel = (scope) => (scope === 'central' ? 'Central' : scope.charAt(0).toUpperCase() + scope.slice(1));

// Item kinds. The plan says what is required; progress says what is built.
// Central progress only holds checkpoints (major milestones confirmed by the founder);
// department progress holds small feature updates.
export const PLAN_KINDS = ['goal', 'must_do', 'must_not', 'decision', 'done'];
export const PROGRESS_KINDS = ['progress', 'checkpoint'];
export const KIND_LABEL = {
  goal: 'Goal', must_do: 'Must do', must_not: 'Must not', decision: 'Decision', done: 'Definition of done',
  progress: 'Progress', checkpoint: 'Checkpoint', note: 'Note',
};
export const isPlan = (kind) => PLAN_KINDS.includes(kind);
export const isProgress = (kind) => PROGRESS_KINDS.includes(kind);

export const toSection = (r) => ({
  id: r.id, scope: r.scope, title: r.title, content: r.content, version: r.version, ownerId: r.owner_id,
  updatedAt: r.updated_at, updatedBy: r.updated_by, why: r.why, tags: r.tags, guardrails: r.guardrails,
  kind: r.kind ?? 'note', meta: r.meta ?? {}, archived: !!r.archived,
});

/** Current context items. Archived (removed) items are kept but left out unless asked for. */
export async function listSections(projectId, scope, { includeArchived = false } = {}) {
  let query = db.from('context_sections').select('*').eq('project_id', projectId);
  if (scope) query = query.eq('scope', scope);
  const all = (await q(query.order('position'))).map(toSection);
  return includeArchived ? all : all.filter((s) => !s.archived);
}

/**
 * The context as layers, each split into plan and progress:
 *   { central: { plan, progress }, department: { plan, progress } }
 */
export function layers(sections, department) {
  const split = (items) => ({
    plan: items.filter((s) => !isProgress(s.kind)),
    progress: items.filter((s) => isProgress(s.kind)),
  });
  return {
    central: split(sections.filter((s) => s.scope === 'central')),
    department: split(sections.filter((s) => department && s.scope === department)),
  };
}

export async function getScopeVersions(projectId) {
  const rows = await q(db.from('scope_versions').select('scope,version').eq('project_id', projectId));
  return Object.fromEntries(rows.map((r) => [r.scope, r.version]));
}

export async function listVersions(projectId, { since, sectionId } = {}) {
  let query = db.from('context_section_versions').select('*').eq('project_id', projectId);
  if (since) query = query.gt('changed_at', since);
  if (sectionId) query = query.eq('section_id', sectionId);
  return (await q(query.order('changed_at', { ascending: false }))).map((r) => ({
    sectionId: r.section_id, scope: r.scope, title: r.title, version: r.version, content: r.content,
    why: r.why, changedBy: r.changed_by, changedAt: r.changed_at,
  }));
}

/**
 * Which sections a task depends on: central + own department sections whose
 * topic tags match words in the task. Sections tagged '*' always apply to
 * their department. Unrelated sections are left out so their changes don't disturb.
 */
export function relevantSections(sections, text, department) {
  const words = tokens(text);
  return sections.filter((s) => {
    if (s.scope !== 'central' && s.scope !== department) return false;
    if (s.scope === department && s.tags.includes('*')) return true;
    return s.tags.some((t) => t !== '*' && !GENERIC_TAGS.has(t) && words.some((w) => tagMatches(t, w)));
  });
}

export async function builtOnFor(projectId, sectionIds) {
  const [sections, scopes] = await Promise.all([listSections(projectId), getScopeVersions(projectId)]);
  const out = {};
  for (const s of sections) if (sectionIds.includes(s.id)) out[s.id] = s.version;
  return { scopes, sections: out };
}

/** Sections that changed since the work was built on them. */
export async function outdatedSince(projectId, builtOn, sections) {
  const all = sections ?? await listSections(projectId);
  const out = [];
  for (const [id, v] of Object.entries(builtOn?.sections ?? {})) {
    const s = all.find((x) => x.id === id);
    if (!s || s.version <= v) continue;
    const changes = (await listVersions(projectId, { sectionId: id }))
      .filter((h) => h.version > v)
      .map((h) => ({ version: h.version, why: h.why, changedBy: h.changedBy, changedAt: h.changedAt }))
      .reverse();
    out.push({ sectionId: id, title: s.title, scope: s.scope, builtOnVersion: v, currentVersion: s.version, changes });
  }
  return out;
}

/** Context guardrails apply whichever agent runs, so warnings are reliable. */
export function guardrailConflicts(text, sections) {
  const lower = String(text).toLowerCase();
  const out = [];
  for (const s of sections) {
    for (const g of s.guardrails) {
      const hit = g.phrase.includes(' ') ? lower.includes(g.phrase) : mentions(text, [g.phrase]).length > 0;
      if (!hit) continue;
      const where = `${s.scope === 'central' ? 'Central' : 'department'} context › ${s.title}`;
      out.push({
        sectionId: s.id, sectionTitle: s.title, scope: s.scope, kind: g.obsoleteSince ? 'outdated' : 'conflict', phrase: g.phrase, note: g.note,
        explanation: g.obsoleteSince
          ? `Your request is based on outdated information: it mentions "${g.phrase}", but ${where} changed in v${g.obsoleteSince}. ${g.note}`
          : `Your request mentions "${g.phrase}", but ${where} (v${s.version}) says: ${g.note}`,
      });
    }
  }
  return out;
}

/** Writes a section's first version (seeding). */
export async function insertSection(projectId, s, position, history = []) {
  const versions = history.length ? history : [{ content: s.content, why: s.why, by: s.ownerId, at: new Date().toISOString() }];
  const last = versions[versions.length - 1];
  const kind = s.kind ?? 'note';
  const meta = s.meta ?? {};
  await q(db.from('context_sections').insert({
    project_id: projectId, id: s.id, scope: s.scope, title: s.title, content: last.content, version: versions.length,
    owner_id: s.ownerId, updated_by: last.by, updated_at: last.at, why: last.why, tags: s.tags ?? [], guardrails: s.guardrails ?? [], position,
    kind, meta, archived: false,
  }));
  await q(db.from('context_section_versions').insert(versions.map((v, i) => ({
    project_id: projectId, section_id: s.id, scope: s.scope, title: s.title, version: i + 1, content: v.content,
    why: v.why, changed_by: v.by, changed_at: v.at, kind, meta, archived: false,
  }))));
}

async function bumpScope(projectId, scope, bumpedScopes) {
  const scopes = await getScopeVersions(projectId);
  let version = scopes[scope] ?? 1;
  if (!bumpedScopes?.has(scope)) {
    version += 1;
    await q(db.from('scope_versions').upsert({ project_id: projectId, scope, version }, { onConflict: 'project_id,scope' }));
    bumpedScopes?.add(scope);
  }
  return version;
}

const levelOf = (scope) => (scope === 'central' ? 'central' : 'department');

/**
 * Adds a new context item (version 1), bumps its scope version and logs it.
 * item: { id?, scope, kind, title, content, why, by, tags?, guardrails?, meta? }
 */
export async function addItem(projectId, item, { cause, bumpedScopes, plain, links } = {}) {
  const existing = await q(db.from('context_sections').select('id').eq('project_id', projectId));
  const id = item.id ?? `${item.scope === 'central' ? 'c' : item.scope.slice(0, 2)}-${item.kind}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  await insertSection(projectId, { ...item, id, ownerId: item.ownerId ?? item.by }, existing.length,
    [{ content: item.content, why: item.why, by: item.by, at: new Date().toISOString() }]);
  const scopeVersion = await bumpScope(projectId, item.scope, bumpedScopes);
  const label = KIND_LABEL[item.kind] ?? 'Item';
  await logEvent(projectId, {
    type: 'context.added', actorId: item.by, department: item.scope === 'central' ? null : item.scope,
    level: levelOf(item.scope), itemId: id, suggestionId: cause?.suggestionId ?? null, taskId: cause?.taskId ?? null,
    checkpointId: item.kind === 'checkpoint' ? id : null,
    title: `${label} added: ${item.title}`, plain: plain ?? item.content, links: links ?? [],
    summary: `${scopeLabel(item.scope)} › ${label} "${item.title}" added: ${item.why}`,
    data: {
      sectionId: id, scope: item.scope, kind: item.kind, title: item.title, toVersion: 1, scopeVersion,
      newValue: item.content, why: item.why, who: item.by, meta: item.meta ?? {}, cause: cause ?? null,
    },
  });
  return { id, version: 1, scopeVersion };
}

/**
 * Writes a new version of one section, bumps its scope version (once per batch
 * via bumpedScopes) and logs old → new with who and why. Nothing is overwritten:
 * every version is kept, and removal is a new version with archived = true.
 */
export async function changeSection(projectId, { sectionId, content, why, by, guardrails, cause, bumpedScopes, meta, archived, plain, links }) {
  const rows = await q(db.from('context_sections').select('*').eq('project_id', projectId).eq('id', sectionId));
  if (!rows[0]) throw new Error(`Unknown section ${sectionId}`);
  const s = toSection(rows[0]);
  const version = s.version + 1;
  const now = new Date().toISOString();
  const nextGuardrails = guardrails ?? s.guardrails;
  const nextMeta = meta ?? s.meta;
  const nextArchived = archived ?? s.archived;
  const nextContent = content ?? s.content;
  await q(db.from('context_sections').update({
    content: nextContent, version, why, updated_by: by, updated_at: now, guardrails: nextGuardrails, meta: nextMeta, archived: nextArchived,
  }).eq('project_id', projectId).eq('id', sectionId));
  await q(db.from('context_section_versions').insert({
    project_id: projectId, section_id: s.id, scope: s.scope, title: s.title, version, content: nextContent, why, changed_by: by, changed_at: now,
    kind: s.kind, meta: nextMeta, archived: nextArchived,
  }));
  const scopeVersion = await bumpScope(projectId, s.scope, bumpedScopes);
  const removed = nextArchived && !s.archived;
  const label = KIND_LABEL[s.kind] ?? 'Item';
  await logEvent(projectId, {
    type: removed ? 'context.removed' : 'context.changed', actorId: by,
    department: s.scope === 'central' ? null : s.scope, level: levelOf(s.scope),
    submissionId: cause?.submissionId ?? null, taskId: cause?.taskId ?? null, suggestionId: cause?.suggestionId ?? null, itemId: s.id,
    checkpointId: s.kind === 'checkpoint' ? s.id : null,
    title: `${label} ${removed ? 'removed' : 'updated'}: ${s.title}`, plain: plain ?? why, links: links ?? [],
    summary: `${scopeLabel(s.scope)} › ${s.title} v${s.version} → v${version}: ${why}`,
    data: {
      sectionId: s.id, scope: s.scope, kind: s.kind, title: s.title, fromVersion: s.version, toVersion: version, scopeVersion,
      oldValue: s.content, newValue: nextContent, why, who: by, guardrails: nextGuardrails, cause: cause ?? null,
    },
  });
  return { section: { ...s, content: nextContent, version, meta: nextMeta, archived: nextArchived }, fromVersion: s.version, toVersion: version };
}

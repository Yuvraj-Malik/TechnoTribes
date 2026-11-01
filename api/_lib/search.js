// Search past notes, summaries, decisions and rejected suggestions.
// By meaning when VOYAGE_API_KEY is set (embeddings, cached per text in
// search_embeddings); otherwise by keywords (stemmed word overlap), and the
// result says which mode ran.
import { createHash } from 'node:crypto';
import { db, q } from './supabase-admin.js';
import { listSections, listVersions, scopeLabel, tokens } from './context.js';
import { suggestions } from './records.js';

const EMBED_URL = 'https://api.voyageai.com/v1/embeddings';
const EMBED_MODEL = process.env.VOYAGE_MODEL || 'voyage-3.5-lite';
const LOG_TYPES = ['review.rejected', 'review.sent_back', 'request.declined', 'request.done', 'context.reverted', 'drift.check', 'suggestion.workaround'];

export const searchMode = () => (process.env.VOYAGE_API_KEY ? 'meaning' : 'keywords');

/** Everything searchable, as plain documents. */
async function documents(projectId, department) {
  const [sections, versions, sugg, log] = await Promise.all([
    listSections(projectId, undefined, { includeArchived: true }),
    listVersions(projectId),
    suggestions.list(projectId, {}, 1000),
    q(db.from('activity_log').select('*').eq('project_id', projectId).in('type', LOG_TYPES).order('id', { ascending: false }).limit(300)),
  ]);
  const visible = (scope) => !scope || scope === 'central' || !department || scope === department;
  const docs = [];
  for (const v of versions) {
    const s = sections.find((x) => x.id === v.sectionId);
    if (!visible(v.scope)) continue;
    docs.push({
      ref: `v:${v.sectionId}:${v.version}`, type: v.version === s?.version ? 'context' : 'old version', id: v.sectionId,
      title: `${scopeLabel(v.scope)} › ${v.title} v${v.version}`, text: `${v.title}. ${v.content} Why: ${v.why}`, scope: v.scope, at: v.changedAt,
    });
  }
  for (const s of sugg) {
    if (!visible(s.scope) || s.status === 'applied') continue;
    const what = s.changes.map((c) => `${c.title ?? ''}: ${c.content ?? ''}`).join(' ');
    const reason = s.decision?.reason ? ` Decision: ${s.decision.reason}` : '';
    docs.push({
      ref: `s:${s.id}`, type: s.status === 'rejected' ? 'rejected suggestion' : `suggestion (${s.status.replace('_', ' ')})`, id: s.id,
      title: `${s.suggesterName}: ${s.changes[0]?.title ?? s.why}`, text: `${what} Why: ${s.why}.${reason} ${(s.reasons ?? []).join(' ')}`,
      scope: s.scope, at: s.decidedAt ?? s.createdAt, status: s.status,
    });
  }
  for (const e of log) {
    if (!visible(e.department)) continue;
    docs.push({ ref: `l:${e.id}`, type: e.type, id: String(e.id), title: e.title ?? e.type, text: `${e.summary} ${e.plain ?? ''}`, scope: e.department ?? 'central', at: e.at });
  }
  return docs;
}

// ---------------------------------------------------------------- keywords
function keywordScores(query, docs) {
  const qWords = tokens(query);
  const df = new Map();
  const docWords = docs.map((d) => tokens(d.text + ' ' + d.title));
  for (const words of docWords) for (const w of new Set(words)) df.set(w, (df.get(w) ?? 0) + 1);
  const match = (a, b) => a === b || (a.length >= 4 && b.startsWith(a)) || (b.length >= 4 && a.startsWith(b));
  return docWords.map((words) => qWords.reduce((sum, qw) => {
    const hit = words.find((w) => match(qw, w));
    return hit ? sum + Math.log(1 + docs.length / (df.get(hit) ?? 1)) : sum;
  }, 0));
}

// ---------------------------------------------------------------- meaning
async function embed(texts, inputType) {
  const res = await fetch(EMBED_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.VOYAGE_API_KEY}` },
    body: JSON.stringify({ input: texts, model: EMBED_MODEL, input_type: inputType }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail || `Embedding error ${res.status}`);
  return data.data.map((d) => d.embedding);
}

const hash = (t) => createHash('sha1').update(t).digest('hex');
const cosine = (a, b) => {
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};

async function meaningScores(projectId, query, docs) {
  const cached = await q(db.from('search_embeddings').select('ref,text_hash,embedding').eq('project_id', projectId));
  const byRef = new Map(cached.map((c) => [c.ref, c]));
  const missing = docs.filter((d) => byRef.get(d.ref)?.text_hash !== hash(d.text));
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    const vectors = await embed(batch.map((d) => d.text.slice(0, 4000)), 'document');
    const rows = batch.map((d, j) => ({ project_id: projectId, ref: d.ref, text_hash: hash(d.text), embedding: vectors[j] }));
    await q(db.from('search_embeddings').upsert(rows, { onConflict: 'project_id,ref' }));
    rows.forEach((r) => byRef.set(r.ref, r));
  }
  const [qv] = await embed([query], 'query');
  return docs.map((d) => cosine(qv, byRef.get(d.ref).embedding));
}

/** Top matches for a query. { mode, results: [{ type, id, title, text, scope, at, score }] } */
export async function search(projectId, query, { department = null, limit = 10, types } = {}) {
  let docs = await documents(projectId, department);
  if (types) docs = docs.filter((d) => types.some((t) => d.type.startsWith(t)));
  let mode = searchMode();
  let scores;
  if (mode === 'meaning') {
    try { scores = await meaningScores(projectId, query, docs); } catch (err) {
      console.warn('[search] embeddings failed, using keywords:', err.message);
      mode = 'keywords';
    }
  }
  if (!scores) scores = keywordScores(query, docs);
  const min = mode === 'meaning' ? 0.3 : 0.01;
  const results = docs.map((d, i) => ({ ...d, score: Math.round(scores[i] * 1000) / 1000 }))
    .filter((d) => d.score > min).sort((a, b) => b.score - a.score).slice(0, limit)
    .map(({ ref: _r, ...d }) => ({ ...d, text: d.text.slice(0, 400) }));
  return { mode, results };
}

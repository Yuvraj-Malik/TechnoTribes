// In-memory stand-in for the parts of the Supabase client our API uses, so the
// team workflow can be tested end to end without a database.
// Supports: select (with one embedded relation), eq/neq/in/gt/or, order, limit,
// single, insert/upsert/update/delete (+ .select()), auth.getUser, auth.admin.createUser.
import { randomUUID } from 'node:crypto';

const RELATIONS = {
  project_members: { profiles: ['user_id', 'id'], projects: ['project_id', 'id'] },
};
const KEYS = {
  context_sections: ['project_id', 'id'],
  context_section_versions: ['project_id', 'section_id', 'version'],
  scope_versions: ['project_id', 'scope'],
  project_files: ['project_id', 'workspace', 'path'],
  project_members: ['project_id', 'user_id'],
};

export function createFakeSupabase() {
  const tables = {};
  let identity = 0;
  const rows = (t) => (tables[t] ??= []);

  function withDefaults(table, r) {
    const now = new Date().toISOString();
    const row = { ...r };
    if (table === 'activity_log') { row.id = ++identity; row.at ??= now; row.data ??= {}; }
    else if (!('id' in row) && !KEYS[table]) row.id = randomUUID();
    if (['dev_tasks', 'work_submissions', 'context_proposals', 'main_commits', 'notifications', 'project_members'].includes(table)) row.created_at ??= now;
    if (table === 'notifications') row.read ??= false;
    if (table === 'project_files') row.updated_at ??= now;
    return row;
  }

  function sameKey(table, a, b, onConflict) {
    const cols = onConflict ? onConflict.split(',') : KEYS[table] ?? ['id'];
    return cols.every((c) => a[c] === b[c]);
  }

  class Query {
    constructor(table) { this.table = table; this.filters = []; this.op = 'select'; this.cols = '*'; }
    select(cols = '*') { if (this.op === 'select') this.cols = cols; else this.returning = true; return this; }
    eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
    neq(c, v) { this.filters.push((r) => r[c] !== v); return this; }
    gt(c, v) { this.filters.push((r) => r[c] > v); return this; }
    in(c, vs) { this.filters.push((r) => vs.includes(r[c])); return this; }
    or(expr) {
      const parts = expr.split(',').map((p) => {
        const [c, op, ...v] = p.split('.');
        const val = v.join('.');
        return (r) => (op === 'eq' ? r[c] === val : op === 'is' && val === 'null' ? r[c] == null : false);
      });
      this.filters.push((r) => parts.some((f) => f(r)));
      return this;
    }
    order(c, { ascending = true } = {}) { this.sort = { c, ascending }; return this; }
    limit(n) { this.max = n; return this; }
    single() { this.one = true; return this; }
    insert(data) { this.op = 'insert'; this.data = [].concat(data); return this; }
    upsert(data, opts = {}) { this.op = 'upsert'; this.data = [].concat(data); this.opts = opts; return this; }
    update(patch) { this.op = 'update'; this.patch = patch; return this; }
    delete() { this.op = 'delete'; return this; }
    match() { return rows(this.table).filter((r) => this.filters.every((f) => f(r))); }

    run() {
      const t = this.table;
      let out;
      if (this.op === 'insert') {
        out = this.data.map((d) => {
          const row = withDefaults(t, d);
          if (KEYS[t] && rows(t).some((r) => sameKey(t, r, row))) throw Object.assign(new Error('duplicate key'), { code: '23505' });
          rows(t).push(row);
          return row;
        });
      } else if (this.op === 'upsert') {
        out = this.data.map((d) => {
          const existing = rows(t).find((r) => sameKey(t, r, d, this.opts.onConflict));
          if (existing) { if (!this.opts.ignoreDuplicates) Object.assign(existing, d); return existing; }
          const row = withDefaults(t, d);
          rows(t).push(row);
          return row;
        });
      } else if (this.op === 'update') {
        out = this.match();
        out.forEach((r) => Object.assign(r, this.patch));
      } else if (this.op === 'delete') {
        out = this.match();
        tables[t] = rows(t).filter((r) => !out.includes(r));
      } else {
        out = this.match();
        if (this.sort) {
          const { c, ascending } = this.sort;
          out = [...out].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (ascending ? 1 : -1));
        }
        if (this.max !== undefined) out = out.slice(0, this.max);
        out = out.map((r) => this.embed(r));
      }
      if (this.op !== 'select' && !this.returning) return { data: null, error: null };
      const data = structuredClone(out);
      if (this.one) return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'not found' } };
      return { data, error: null };
    }

    embed(r) {
      const rel = RELATIONS[this.table];
      if (!rel || typeof this.cols !== 'string') return r;
      const out = { ...r };
      for (const [name, [fk, pk]] of Object.entries(rel)) {
        if (this.cols.includes(`${name}(`)) out[name] = rows(name).find((x) => x[pk] === r[fk]) ?? null;
      }
      return out;
    }

    then(resolve, reject) {
      try { resolve(this.run()); } catch (err) { resolve({ data: null, error: { code: err.code, message: err.message } }); }
      return undefined;
    }
  }

  const client = {
    tables,
    from: (t) => new Query(t),
    auth: {
      tokens: {},
      async getUser(token) {
        const id = client.auth.tokens[token];
        return id ? { data: { user: { id, email: rows('profiles').find((p) => p.id === id)?.email } }, error: null } : { data: null, error: { message: 'bad token' } };
      },
      admin: {
        async createUser({ email, user_metadata }) {
          const id = randomUUID();
          rows('profiles').push({ id, email, display_name: user_metadata?.display_name, is_demo: false });
          return { data: { user: { id, email } }, error: null };
        },
      },
    },
    /** Test helper: a signed-in person with a bearer token. */
    addUser(name) {
      const id = randomUUID();
      rows('profiles').push({ id, email: `${name.toLowerCase()}@example.com`, display_name: name, is_demo: false });
      client.auth.tokens[`token-${name}`] = id;
      return { id, token: `token-${name}` };
    },
  };
  return client;
}

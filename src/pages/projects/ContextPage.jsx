// Project context: the brief and requirements every agent reads before acting.
// Owner edits central + every department; an admin edits their department;
// developers read it. Every edit needs a reason, shows who it affects before
// saving, and alerts developers whose active work depends on it.
import { useEffect, useMemo, useState } from 'react';
import { useTeam } from '../../context/TeamContext';
import { Badge, Button, cx } from '../../components/common/ui';
import { PageHeader } from '../../components/dashboard/ui';
import { timeAgo } from '../../utils/time';
import { Loading, Notice, Page, Section, areaClass, inputClass, useAction, useLive } from './shared';

function canEdit(me, scope) {
  if (me.actingAs && me.role !== 'admin') return false;
  return me.role === 'owner' ? true : me.role === 'admin' && me.department === scope;
}

function ImpactPreview({ preview }) {
  const { impact } = preview;
  return (
    <div className="mt-4 rounded-xl border border-mark bg-mark/10 p-4 text-sm">
      <p className="m-0 font-semibold text-ink">Before you save: who this affects</p>
      <ul className="m-0 mt-2 list-disc space-y-1 pl-5 text-ink">
        {impact.reasons.map((r) => <li key={r}>{r}</li>)}
      </ul>
      {impact.notify.length > 0 && (
        <div className="mt-3">
          <p className="m-0 text-xs font-semibold tracking-wide text-dim uppercase">Will be told</p>
          <ul className="m-0 mt-1 list-none space-y-1 p-0">
            {impact.notify.map((n) => (
              <li key={n.userId} className="flex gap-2">
                <Badge tone={n.affectsActiveWork ? 'red' : 'blue'}>{n.affectsActiveWork ? 'Work paused' : 'Notified'}</Badge>
                <span><strong>{n.name}</strong>: {n.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {impact.unaffected.length > 0 && (
        <div className="mt-3">
          <p className="m-0 text-xs font-semibold tracking-wide text-dim uppercase">Keeps going</p>
          <ul className="m-0 mt-1 list-none space-y-1 p-0 text-dim">
            {impact.unaffected.map((n) => <li key={n.userId}><strong className="text-ink">{n.name}</strong>: {n.reason}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function SectionEditor({ section, scope, editable, onSaved }) {
  const { post } = useTeam();
  const act = useAction();
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(section.content);
  const [why, setWhy] = useState('');
  const [preview, setPreview] = useState(null);
  useEffect(() => { if (!editing) setContent(section.content); }, [section.content, editing]);

  const edits = [{ sectionId: section.id, content, why }];
  const changed = content.trim() !== section.content.trim();
  const runPreview = () => act.run('preview', async () => setPreview(await post('context/preview', { scope, edits })));
  const save = async () => {
    const r = await act.run('save', () => post('context/save', { scope, edits }));
    if (!r) return;
    // Edits go through the change router: some apply now, some wait for the founder.
    const waiting = r.suggestions.find((x) => x.status === 'pending_founder' || x.status === 'pending_manager');
    act.setOk(waiting
      ? `Sent for approval: ${waiting.status === 'pending_founder' ? 'the founder' : 'the department manager'} decides. ${waiting.reasons?.[0] ?? ''}`
      : 'Saved and logged. Everyone affected was told.');
    setEditing(false); setPreview(null); setWhy(''); onSaved();
  };

  return (
    <article className="border-b border-line py-4 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="m-0 text-[15px] font-semibold text-ink">{section.title}</h3>
          <p className="m-0 mt-0.5 text-xs text-dim">v{section.version}{section.updatedAt ? ` · updated ${timeAgo(section.updatedAt)}` : ''}{section.why && section.version > 1 ? ` · “${section.why}”` : ''}</p>
        </div>
        {editable && !editing && <Button variant="secondary" className="min-h-11" onClick={() => setEditing(true)}>Edit</Button>}
      </div>
      {!editing ? (
        <>
          <p className="m-0 mt-2 whitespace-pre-line text-sm leading-relaxed text-ink">{section.content}</p>
          {act.ok && <div className="mt-2"><Notice ok={act.ok} /></div>}
        </>
      ) : (
        <div className="mt-3 space-y-3">
          <Notice error={act.error} />
          <label className="block">
            <span className="sr-only">Content</span>
            <textarea className={areaClass} rows={Math.min(12, Math.max(4, content.split('\n').length + 1))} value={content} onChange={(e) => { setContent(e.target.value); setPreview(null); }} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Why is this changing?</span>
            <input className={inputClass} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="The team and the agents read this reason" />
          </label>
          {preview && <ImpactPreview preview={preview} />}
          <div className="flex flex-wrap gap-2">
            {!preview
              ? <Button className="min-h-11" disabled={!changed || !!act.busy} onClick={runPreview}>{act.busy ? 'Checking…' : 'Check who it affects'}</Button>
              : <Button className="min-h-11" disabled={!why.trim() || !!act.busy} onClick={save}>{act.busy ? 'Saving…' : 'Save change'}</Button>}
            <Button variant="ghost" className="min-h-11" onClick={() => { setEditing(false); setPreview(null); setContent(section.content); }}>Cancel</Button>
          </div>
          {preview && !why.trim() && <p className="m-0 text-xs text-dim">Add a reason to save.</p>}
        </div>
      )}
    </article>
  );
}

function NewSection({ scope, onCreated }) {
  const { post } = useTeam();
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', tags: '' });
  if (!open) return <Button variant="secondary" className="min-h-11" onClick={() => setOpen(true)}>+ Add section</Button>;
  const submit = async (e) => {
    e.preventDefault();
    const r = await act.run('create', () => post('context/create', { scope, ...form }));
    if (r) { setForm({ title: '', content: '', tags: '' }); setOpen(false); onCreated(); }
  };
  return (
    <form onSubmit={submit} className="w-full space-y-3 rounded-xl border border-line bg-bg/50 p-4">
      <Notice error={act.error} />
      <input className={inputClass} required placeholder="Title, e.g. Accessibility rules" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <textarea className={areaClass} required rows={4} placeholder="What every agent and developer should follow" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
      <input className={inputClass} placeholder="Keywords (comma separated) so agents know when it applies" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
      <div className="flex gap-2">
        <Button type="submit" className="min-h-11" disabled={!!act.busy}>Add section</Button>
        <Button variant="ghost" className="min-h-11" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}

export default function ContextPage() {
  const { get, post, me, boot, deptById } = useTeam();
  const { data, loading, error, reload } = useLive(() => get('context'), [me.id]);
  const sections = useMemo(() => data?.all ?? [...(data?.central ?? []), ...(data?.department ?? [])], [data]);
  const scopes = useMemo(() => {
    const list = [{ id: 'central', name: 'Central (whole project)' }];
    const deptIds = me.role === 'owner' && !me.actingAs ? boot.departments.map((d) => d.id) : [me.department].filter(Boolean);
    for (const id of deptIds) list.push({ id, name: deptById(id)?.name ?? id });
    return list;
  }, [me, boot.departments, deptById]);
  const [scope, setScope] = useState('central');
  const changed = data?.changedSinceLastVisit ?? [];

  if (loading && !data) return <Page><Loading /></Page>;
  const shown = sections.filter((s) => s.scope === scope);
  const editable = canEdit(me, scope);

  return (
    <Page>
      <PageHeader
        title="Project context"
        description="The brief and the rules every agent reads before it plans anything. Change it here and the people whose work depends on it are told right away."
      />
      <Notice error={error} />
      {changed.length > 0 && (
        <div className="mb-5 rounded-xl border border-accent/40 bg-accent/5 p-4 text-sm">
          <p className="m-0 font-semibold text-ink">Changed since your last visit</p>
          <ul className="m-0 mt-2 list-disc space-y-1 pl-5">
            {changed.map((v) => <li key={`${v.sectionId}-${v.version}`}>{v.title ?? v.sectionId} → v{v.version}{v.why ? `: ${v.why}` : ''}</li>)}
          </ul>
          <Button size="sm" className="mt-3 min-h-9" onClick={() => post('context/seen').then(reload)}>Got it</Button>
        </div>
      )}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Context scope">
        {scopes.map((s) => (
          <button
            key={s.id} type="button" role="tab" aria-selected={scope === s.id} onClick={() => setScope(s.id)}
            className={cx('min-h-11 shrink-0 cursor-pointer rounded-full border-[1.5px] px-4 text-sm font-semibold',
              scope === s.id ? 'border-accent bg-accent/10 text-accent' : 'border-line bg-surface text-dim hover:text-ink')}
          >
            {s.name} <span className="font-normal">v{data?.scopeVersions?.[s.id] ?? 1}</span>
          </button>
        ))}
      </div>
      <Section
        title={scopes.find((s) => s.id === scope)?.name}
        description={editable ? 'You can edit this. Each change needs a reason.' : scope === 'central' ? 'Only the owner changes the central context.' : 'Only the owner or this department\'s manager changes it.'}
        right={editable && <NewSection scope={scope} onCreated={reload} />}
      >
        {shown.length === 0 ? <p className="m-0 py-4 text-sm text-dim">No sections here yet.</p>
          : shown.map((s) => <SectionEditor key={s.id} section={s} scope={scope} editable={editable} onSaved={reload} />)}
      </Section>
    </Page>
  );
}

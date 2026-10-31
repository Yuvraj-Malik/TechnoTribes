// The project brief. Every agent reads it before it works, so a change here goes
// through an impact check first: the owner sees what it would make out of date.
import { useMemo, useState } from 'react';
import { api } from '../../services/apiClient';
import { useOwner } from '../../features/projects/ownerContext';
import { useProjectResource } from '../../features/projects/useProjectResource';
import { briefPatch, briefRows, fieldKey, fieldLabel } from '../../features/projects/briefModel';
import { impactOf } from '../../features/coordination/codeModel';
import Alert from '../../components/common/Alert';
import Badge from '../../components/common/Badge';
import Field from '../../components/common/Field';
import PageHeader from '../../components/common/PageHeader';
import TextArea from '../../components/common/TextArea';
import { when } from '../../components/timeline/RecentChanges';
import { card, outlineButton, quietButton, sectionTitle, solidButton } from '../../components/common/styles';

function ImpactList({ title, items }) {
  if (!items.length) return null;
  return (
    <div className="mt-3">
      <div className="text-[13px] font-semibold">{title}</div>
      <ul className="m-0 mt-1 list-disc space-y-0.5 pl-5 text-sm text-dim">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

function ImpactReview({ preview, nextVersion, reason, onReason, onSave, onBack, busy }) {
  const { changedFields, impact } = preview;
  const stale = [
    ...impact.staleProposals.map((p) => `${p.who || 'Someone'}: ${p.summary}`),
    ...impact.staleMergeRequests.map((m) => `${m.who || 'Someone'}: a request waiting for review`),
  ];
  const interrupted = impact.interruptedWork.map((w) => `${w.who || 'Someone'}: ${w.goal}`);
  const clear = !stale.length && !interrupted.length;

  return (
    <div className={`${card} border-mark p-4`}>
      <h2 className={sectionTitle}>Check the impact before saving</h2>
      <p className="m-0 mt-1 text-sm text-dim">
        {clear ? 'No open work depends on these fields.' : `This reaches ${impact.peopleAffected.length || 'no other'} ${impact.peopleAffected.length === 1 ? 'person' : 'people'}. They are told to re-run on the new version.`}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {changedFields.map((key) => <Badge key={key} tone="warn">req:{key}</Badge>)}
      </div>
      <ImpactList title="Connected parts of the product" items={impact.affectedAreas} />
      <ImpactList title="Goes out of date" items={stale} />
      <ImpactList title="Interrupted right now" items={interrupted} />
      <div className="mt-4">
        <TextArea label="Why is this changing?" hint="Saved with the version, so the team and their agents can see the reason." rows={2} value={reason} onChange={(e) => onReason(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={solidButton} disabled={busy} onClick={onSave}>Save as v{nextVersion}</button>
        <button type="button" className={quietButton} onClick={onBack}>Keep editing</button>
      </div>
    </div>
  );
}

export default function BriefTab() {
  const { projectId, data, version, reload } = useOwner();
  const state = useProjectResource('moderator/state');
  const graph = useProjectResource('moderator/graph');
  const [draft, setDraft] = useState(null); // null = reading, not editing
  const [newField, setNewField] = useState('');
  const [preview, setPreview] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const brief = state.data?.brief;
  const rows = useMemo(() => briefRows(brief), [brief]);
  const history = data.log.filter((entry) => entry.kind === 'brief');
  const edges = graph.data?.edges;

  const filled = rows.filter((row) => row.value);
  const reach = (key) => impactOf(`req:${key}`, edges).affects.size;
  const draftRows = draft ? [
    ...rows,
    ...Object.keys(draft).filter((key) => !rows.some((row) => row.key === key)).map((key) => ({ key, label: fieldLabel(key), hint: '' })),
  ] : [];

  function startEditing() {
    setDraft(Object.fromEntries(rows.map((row) => [row.key, row.value])));
    setSaved('');
    setError('');
  }

  function stopEditing() {
    setDraft(null);
    setPreview(null);
    setReason('');
    setNewField('');
    setError('');
  }

  function addField(e) {
    e.preventDefault();
    const key = fieldKey(newField);
    if (!key) return;
    setDraft({ [key]: '', ...draft });
    setNewField('');
  }

  async function checkImpact() {
    const patch = briefPatch(brief, draft);
    if (!Object.keys(patch).length) return setError('Nothing has changed yet.');
    setBusy(true);
    setError('');
    try {
      setPreview(await api('projects/brief/preview', { method: 'POST', body: { projectId, brief: patch } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      const result = await api('projects/brief', {
        method: 'POST',
        body: { projectId, brief: briefPatch(brief, draft), reason: reason.trim() },
      });
      const people = result.impact?.peopleAffected || [];
      setSaved(`Saved as v${result.version}.${people.length ? ` ${people.join(', ')} ${people.length === 1 ? 'was' : 'were'} told to re-run on the new version.` : ''}`);
      stopEditing();
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Project brief"
        actions={filled.length > 0 && !draft && <button type="button" className={outlineButton} onClick={startEditing}>Edit brief</button>}
      >
        The single source of truth for every Builder and Critic. Changing it creates a new version.
      </PageHeader>

      <Alert tone="error">{error || state.error}</Alert>
      <Alert tone="ok">{saved}</Alert>

      <div className="grid gap-7 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div>
          {!brief && !state.error && <p className="text-dim" role="status">Loading…</p>}

          {brief && !draft && !filled.length && (
            <div className={`${card} px-6 py-10 text-center`}>
              <p className="m-0 font-semibold">No brief yet</p>
              <p className="m-0 mx-auto mt-1 max-w-md text-sm text-dim">Agents can start once they know what you are building. This becomes version 1.</p>
              <button type="button" className={`${solidButton} mt-4`} onClick={startEditing}>Write the brief</button>
            </div>
          )}

          {brief && !draft && filled.length > 0 && (
            <dl className={`${card} m-0 divide-y divide-line`}>
              {filled.map((row) => (
                <div key={row.key} className="px-4 py-3.5">
                  <dt className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold">{row.label}</span>
                    <code className="font-mono text-xs text-dim">req:{row.key}</code>
                    {reach(row.key) > 0 && <span className="text-xs text-dim">· affects {reach(row.key)} {reach(row.key) === 1 ? 'part' : 'parts'}</span>}
                  </dt>
                  <dd className="m-0 mt-1 text-[15px] break-words whitespace-pre-wrap">{row.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {draft && !preview && (
            <div className={`${card} p-4`}>
              {draftRows.map((row) => (
                <TextArea
                  key={row.key}
                  label={row.label}
                  hint={row.hint}
                  rows={2}
                  value={draft[row.key] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [row.key]: e.target.value })}
                />
              ))}
              <form onSubmit={addField} className="flex items-end gap-2">
                <Field className="mb-0! min-w-0 flex-1" label="Add another requirement" placeholder="Launch date" value={newField} onChange={(e) => setNewField(e.target.value)} />
                <button type="submit" className={outlineButton}>Add</button>
              </form>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                <button type="button" className={solidButton} disabled={busy} onClick={checkImpact}>Check impact</button>
                <button type="button" className={quietButton} onClick={stopEditing}>Cancel</button>
              </div>
            </div>
          )}

          {draft && preview && (
            <ImpactReview
              preview={preview}
              nextVersion={version + 1}
              reason={reason}
              onReason={setReason}
              onSave={save}
              onBack={() => setPreview(null)}
              busy={busy}
            />
          )}
        </div>

        <section>
          <h2 className={`${sectionTitle} mb-2`}>Brief history</h2>
          {history.length ? (
            <ol className={`${card} m-0 list-none divide-y divide-line p-0`}>
              {history.slice(0, 8).map((entry) => (
                <li key={entry.version} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>v{entry.version}</Badge>
                    <span className="text-xs text-dim">{when(entry.created_at)}</span>
                  </div>
                  <p className="m-0 mt-1.5 text-sm">{entry.summary}</p>
                  {entry.reason && <p className="m-0 text-[13px] text-dim">{entry.reason}</p>}
                </li>
              ))}
            </ol>
          ) : (
            <p className={`${card} m-0 px-4 py-6 text-center text-sm text-dim`}>Each saved change to the brief shows up here.</p>
          )}
        </section>
      </div>
    </>
  );
}

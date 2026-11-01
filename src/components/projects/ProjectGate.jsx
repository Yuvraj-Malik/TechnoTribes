// Asks for the project ID (from the owner) before showing a project's pages.
// Once entered, it is remembered for this browser tab. The observer joined with the
// project's own observer code, so they never need the project ID.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/apiClient';
import Field from '../common/Field';
import Icon from '../common/Icon';
import { primaryButton, focusRing } from '../common/styles';

export const enteredKey = (id) => `buildify:entered:${id}`;

export function isEntered(id) {
  try { return sessionStorage.getItem(enteredKey(id)) === '1'; } catch { return false; }
}

export function markEntered(id) {
  try { sessionStorage.setItem(enteredKey(id), '1'); } catch { /* storage blocked */ }
}

function GateForm({ projectId, onEntered }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('projects/enter', { method: 'POST', body: { projectId, code: code.trim() } });
      markEntered(projectId);
      onEntered();
    } catch (err) {
      setError(err.message);
      ref.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-[440px] rounded-2xl border border-line bg-surface p-6 sm:p-8">
        <span className="mb-4 grid size-12 place-items-center rounded-full bg-accent/10 text-accent"><Icon name="lock" size={22} /></span>
        <h1 className="m-0 font-display text-[26px] leading-tight font-bold tracking-[-0.02em]">Enter the project ID</h1>
        <p className="m-0 mt-1.5 mb-5 text-dim">Ask the project owner for it. It looks like PRJ-7K2QXM9P.</p>
        <form onSubmit={submit} noValidate>
          <Field
            ref={ref}
            label="Project ID"
            placeholder="PRJ-7K2QXM9P"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            error={error}
          />
          <button type="submit" className={primaryButton} disabled={busy || !code.trim()}>{busy ? 'Checking…' : 'Open project'}</button>
        </form>
        <Link to="/dashboard/projects" className={`mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-dim underline ${focusRing}`}>Back to my projects</Link>
      </div>
    </div>
  );
}

export default function ProjectGate({ projectId, children }) {
  const [entered, setEntered] = useState(() => isEntered(projectId));
  const [checking, setChecking] = useState(!entered);
  useEffect(() => {
    if (entered) return;
    api('projects/get', { query: { projectId } })
      .then((r) => { if (r.role === 'observer') { markEntered(projectId); setEntered(true); } })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, [projectId, entered]);
  if (!entered && checking) return <div className="grid flex-1 place-items-center p-10 text-dim" role="status">Opening project…</div>;
  if (!entered) return <GateForm projectId={projectId} onEntered={() => setEntered(true)} />;
  return children;
}

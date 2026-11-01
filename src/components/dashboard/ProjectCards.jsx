// Cards for "my projects" and "explore", plus the dialogs they open.
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../common/Icon';
import Modal from '../common/Modal';
import Field from '../common/Field';
import Alert from '../common/Alert';
import { focusRing, primaryButton } from '../common/styles';
import { api } from '../../services/apiClient';
import { timeAgo } from '../../utils/format';
import { RoleBadge, ProjectMark, buttonPrimary, buttonSecondary } from './ui';

const cardBase = '@container flex flex-col rounded-xl border border-line bg-surface p-5 transition-shadow hover:shadow-[0_10px_30px_-18px_rgba(0,0,0,0.35)]';

import { markEntered } from '../projects/ProjectGate';

function CopyCode({ label, code }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked: the code is still visible to select */ }
  }
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-bg px-3 py-1.5">
      <div className="min-w-0">
        <p className="m-0 text-[11px] font-semibold tracking-[0.06em] text-dim uppercase">{label}</p>
        <p className="m-0 truncate font-mono text-sm font-semibold tracking-wide">{code}</p>
      </div>
      <button type="button" onClick={copy} aria-label={`Copy ${label}`} className={`grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-dim hover:text-ink ${focusRing}`}>
        <Icon name={copied ? 'check' : 'copy'} size={17} className={copied ? 'text-ok' : ''} />
      </button>
      <span className="sr-only" aria-live="polite">{copied ? 'Copied' : ''}</span>
    </div>
  );
}

export function EnterProjectDialog({ project, onClose }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  async function submit(e) {
    e.preventDefault();
    if (!/^PRJ-[A-Z0-9]{8}$/i.test(code.trim())) {
      setError('Project IDs look like PRJ-7K2QXM9P.');
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api('projects/enter', { method: 'POST', body: { projectId: project.projectId, code: code.trim() } });
      markEntered(project.projectId);
      navigate(`/projects/${project.projectId}`);
    } catch (err) {
      setError(err.message);
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={Boolean(project)}
      onClose={onClose}
      title={project ? `Open ${project.name}` : ''}
      description="Enter the project ID the project owner shared with you."
    >
      <form onSubmit={submit} noValidate>
        <Field
          ref={inputRef}
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
        <button type="submit" className={`${primaryButton} mt-1`} disabled={busy}>
          {busy ? 'Checking…' : 'Open project'}
        </button>
      </form>
    </Modal>
  );
}

export function JoinRequestDialog({ project, onClose, onSent }) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('projects/join-request', { method: 'POST', body: { projectId: project.id, message: message.trim() || undefined } });
      onSent?.(project.id);
      onClose();
    } catch (err) {
      setError(err.status === 409 ? 'You already asked to join this project.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={Boolean(project)}
      onClose={onClose}
      title={project ? `Ask to join ${project.name}` : ''}
      description="The project's admins get your request and can add you as a worker."
    >
      <form onSubmit={submit} noValidate>
        <Alert tone="error">{error}</Alert>
        <label htmlFor="join-message" className="mb-1.5 block text-sm font-semibold">
          Message <span className="font-normal text-dim">(optional)</span>
        </label>
        <textarea
          id="join-message"
          rows={4}
          maxLength={500}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="I'm a frontend developer and can help with the pricing page."
          className={`mb-4 w-full resize-y rounded-lg border-[1.5px] border-line bg-surface px-3.5 py-3 font-sans text-base text-ink ${focusRing}`}
        />
        <button type="submit" className={primaryButton} disabled={busy}>
          {busy ? 'Sending…' : 'Send request'}
        </button>
      </form>
    </Modal>
  );
}

export function MyProjectCard({ project, onOpen }) {
  const pending = project.status === 'pending';
  return (
    <article className={cardBase}>
      <div className="flex items-start gap-3.5">
        <ProjectMark name={project.name} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="m-0 truncate text-[17px] font-semibold">{project.name}</h3>
            <RoleBadge role={project.role} pending={pending} />
          </div>
          <p className="m-0 mt-1 line-clamp-2 text-sm text-dim">{project.description || 'No description yet.'}</p>
        </div>
      </div>

      {project.role === 'owner' && (
        <div className="mt-4 grid gap-2 @[440px]:grid-cols-2">
          <CopyCode label="Project ID" code={project.projectCode} />
          <CopyCode label="Observer code" code={project.observerCode} />
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <span className="inline-flex items-center gap-1.5 text-sm text-dim">
          <Icon name="users" size={16} /> {project.members} {project.members === 1 ? 'member' : 'members'}
        </span>
        {pending ? (
          <span className="inline-flex min-h-11 items-center gap-1.5 text-sm text-dim"><Icon name="clock" size={16} /> Waiting for the owner</span>
        ) : (
          <button type="button" onClick={() => onOpen(project)} className={buttonPrimary}>
            <Icon name="lock" size={16} /> Open
          </button>
        )}
      </div>
    </article>
  );
}

export function ExploreProjectCard({ project, onRequest }) {
  return (
    <article className={cardBase}>
      <div className="flex items-start gap-3.5">
        <ProjectMark name={project.name} />
        <div className="min-w-0 flex-1">
          <h3 className="m-0 truncate text-[17px] font-semibold">{project.name}</h3>
          <p className="m-0 mt-0.5 text-[13px] text-dim">
            {project.owner ? `by ${project.owner}` : 'Owner unknown'} · {timeAgo(project.createdAt)}
          </p>
        </div>
      </div>
      <p className="m-0 mt-3 line-clamp-2 text-sm text-dim">{project.description || 'No description yet.'}</p>
      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <span className="inline-flex items-center gap-1.5 text-sm text-dim">
          <Icon name="users" size={16} /> {project.members} {project.members === 1 ? 'member' : 'members'}
        </span>
        {project.requestPending ? (
          <span className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] px-2 text-sm font-semibold text-dim">
            <Icon name="clock" size={16} /> Requested
          </span>
        ) : (
          <button type="button" onClick={() => onRequest(project)} className={buttonSecondary}>
            Ask to join
          </button>
        )}
      </div>
    </article>
  );
}

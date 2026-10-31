// Project settings: details, the GitHub repo, invite codes, theme and account.
import { useState } from 'react';
import { api } from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useOwner } from '../../features/projects/ownerContext';
import ActionButton from '../../components/common/ActionButton';
import Alert from '../../components/common/Alert';
import Field from '../../components/common/Field';
import PageHeader from '../../components/common/PageHeader';
import TextArea from '../../components/common/TextArea';
import ThemeToggle from '../../components/common/ThemeToggle';
import { outlineButton, quietButton, sectionTitle } from '../../components/common/styles';

function Section({ title, hint, children }) {
  return (
    <section className="grid gap-x-8 gap-y-3 border-b border-line py-6 first:pt-0 last:border-b-0 md:grid-cols-[220px_minmax(0,1fr)]">
      <div>
        <h2 className={sectionTitle}>{title}</h2>
        {hint && <p className="m-0 mt-1 text-sm text-dim">{hint}</p>}
      </div>
      <div className="max-w-xl min-w-0">{children}</div>
    </section>
  );
}

const Code = ({ children }) => (
  <code className="block rounded-lg border border-dashed border-accent bg-surface px-3.5 py-2.5 font-mono text-base font-semibold break-all select-all">{children}</code>
);

function ProjectDetails() {
  const { data, projectId, act } = useOwner();
  const [name, setName] = useState(data.project.name);
  const [description, setDescription] = useState(data.project.description || '');
  const [saved, setSaved] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setSaved(await act('projects/update', { projectId, name, description }));
  }

  return (
    <form onSubmit={onSubmit}>
      <Field label="Project name" value={name} required onChange={(e) => { setName(e.target.value); setSaved(false); }} />
      <TextArea label="Description" rows={2} value={description} onChange={(e) => { setDescription(e.target.value); setSaved(false); }} />
      <Alert tone="ok">{saved ? 'Saved.' : ''}</Alert>
      <button type="submit" className={outlineButton}>Save details</button>
    </form>
  );
}

function Repository() {
  const { data, projectId, act } = useOwner();
  const { project } = data;
  const [owner, setOwner] = useState(project.repo_owner || '');
  const [name, setName] = useState(project.repo_name || '');
  const [branch, setBranch] = useState(project.default_branch || 'main');
  const [notice, setNotice] = useState('');
  const connected = project.repo_owner && project.repo_name;

  async function onSubmit(e) {
    e.preventDefault();
    setNotice('');
    if (await act('projects/update', { projectId, repo: { owner, name, branch } })) setNotice('Repository saved.');
  }

  async function importCode() {
    setNotice('');
    if (await act('github/import', { projectId })) setNotice('Code imported as a new version.');
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label="Owner" placeholder="acme" value={owner} onChange={(e) => setOwner(e.target.value)} />
        <Field label="Repository" placeholder="website" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <Field label="Default branch" value={branch} onChange={(e) => setBranch(e.target.value)} />
      <Alert tone="ok">{notice}</Alert>
      <div className="flex flex-wrap gap-1">
        <button type="submit" className={outlineButton}>Save repository</button>
        {connected && <ActionButton variant="quiet" onAction={importCode}>Import code from GitHub</ActionButton>}
      </div>
    </form>
  );
}

function Access() {
  const { data, projectId, act } = useOwner();
  const [adminCode, setAdminCode] = useState(null);
  const [error, setError] = useState('');
  const hasInvestor = data.members.some((m) => m.role === 'observer');

  async function createAdminCode() {
    setError('');
    try {
      setAdminCode(await api('projects/admin-code', { method: 'POST', body: { projectId } }));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-1.5 text-sm font-semibold">Invite an admin</div>
        {adminCode ? (
          <>
            <Code>{adminCode.code}</Code>
            <p className="m-0 mt-1.5 text-[13px] text-dim">Works once, until {new Date(adminCode.expiresAt).toLocaleDateString()}. You approve them after they join.</p>
          </>
        ) : (
          <ActionButton onAction={createAdminCode}>Create admin code</ActionButton>
        )}
      </div>
      <div>
        <div className="mb-1.5 text-sm font-semibold">Investor code</div>
        {hasInvestor ? (
          <p className="m-0 text-sm text-dim">Your investor has joined. Each project has one.</p>
        ) : (
          <>
            <Code>{data.project.observer_code}</Code>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-dim">Share this with your investor.</span>
              <ActionButton variant="quiet" onAction={() => act('projects/observer-code', { projectId })}>Replace code</ActionButton>
            </div>
          </>
        )}
      </div>
      <Alert tone="error">{error}</Alert>
    </div>
  );
}

export default function SettingsTab() {
  const { user, signOut } = useAuth();
  return (
    <>
      <PageHeader title="Settings" />
      <Section title="Project" hint="Shown to your whole team."><ProjectDetails /></Section>
      <Section title="Repository" hint="Optional. Lets you import a GitHub repo as the starting code."><Repository /></Section>
      <Section title="Invites" hint="Admins and your investor join with a code."><Access /></Section>
      <Section title="Appearance"><ThemeToggle /></Section>
      <Section title="Account" hint={user?.email}>
        <button type="button" className={quietButton} onClick={signOut}>Sign out</button>
      </Section>
    </>
  );
}

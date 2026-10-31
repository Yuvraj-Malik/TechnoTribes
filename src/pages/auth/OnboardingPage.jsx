// After the first sign-in: start a project (becomes Owner) or join one with a code.
//   ADM-XXXXXXXX -> admin (waits for the owner's approval)
//   OBS-XXXXXXXX -> observer (sees progress in plain language)
// Workers do not need a code: an admin adds them by email.
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import { isProjectCode } from '../../utils/validation';
import AuthLayout from '../../components/auth/AuthLayout';
import Field from '../../components/common/Field';
import Alert from '../../components/common/Alert';
import { primaryButton, heading, subheading, focusRing } from '../../components/common/styles';

const ROLES = [
  { id: 'founder', title: 'Founder', text: 'I am starting a project and make the final calls.' },
  { id: 'teammate', title: 'Teammate', text: 'Admin, investor or advisor joining with a code.' },
];

function RoleCard({ role, checked, onChange }) {
  const id = `role-${role.id}`;
  return (
    <div className="relative">
      <input
        type="radio"
        name="role"
        id={id}
        value={role.id}
        checked={checked}
        onChange={onChange}
        className="peer absolute inset-0 cursor-pointer opacity-0"
      />
      <label
        htmlFor={id}
        className="block h-full cursor-pointer rounded-[10px] border-[1.5px] border-line bg-surface px-3.5 py-3 peer-checked:border-accent peer-checked:shadow-[inset_0_0_0_1px_var(--accent)] peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-mark peer-focus-visible:outline-solid"
      >
        <b className="block text-[15px]">{role.title}</b>
        <span className="mt-0.5 block text-[13px] leading-[1.35] text-dim">{role.text}</span>
      </label>
    </div>
  );
}

function Done({ result, onContinue }) {
  return (
    <div aria-live="polite">
      <div className="mb-4 grid size-11 place-items-center rounded-full bg-ok text-[22px] text-white" aria-hidden="true">✓</div>
      <h1 className={heading}>{result.title}</h1>
      <p className={subheading}>{result.sub}</p>
      {result.observerCode && (
        <div className="mb-[18px] rounded-lg border-[1.5px] border-dashed border-accent bg-surface px-3.5 py-3">
          <div className="text-[13px] text-dim">Observer code (share it with your investor or advisor)</div>
          <div className="font-display text-xl font-bold tracking-wide">{result.observerCode}</div>
        </div>
      )}
      <ul className="my-[18px] list-none p-0">
        {result.steps.map((step) => (
          <li key={step} className="mb-2 rounded-lg border border-line bg-surface px-3.5 py-3 text-[15px]">{step}</li>
        ))}
      </ul>
      <button type="button" className={primaryButton} onClick={onContinue}>Open my workspace</button>
    </div>
  );
}

export default function OnboardingPage() {
  const { user, signOut } = useAuth();
  const [role, setRole] = useState('founder');
  const [workspace, setWorkspace] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const wsRef = useRef(null);
  const codeRef = useRef(null);
  const navigate = useNavigate();
  const firstName = (user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email || '').split(/[\s@]/)[0];

  async function onSubmit(e) {
    e.preventDefault();
    setErrors({});
    setFormError('');

    if (role === 'founder' && workspace.trim().length < 2) {
      setErrors({ workspace: 'Name your workspace so teammates can find it.' });
      return wsRef.current?.focus();
    }
    if (role === 'teammate' && !isProjectCode(code)) {
      setErrors({ code: 'Enter the code in the form ADM-7K2QXM9P or OBS-7K2QXM9P.' });
      return codeRef.current?.focus();
    }

    setBusy(true);
    try {
      if (role === 'founder') {
        const { project, observerCode } = await api('projects/create', { method: 'POST', body: { name: workspace.trim() } });
        setResult({
          projectId: project.id,
          title: `Welcome, ${firstName}`,
          sub: `Your workspace "${project.name}" is ready. You are its Owner.`,
          observerCode,
          steps: [
            'Write the project brief (this becomes version 1)',
            'Create admin codes and invite your admins',
            'Admins add workers, and everyone gets their own Builder and Critic',
          ],
        });
      } else {
        const joined = await api('projects/join', { method: 'POST', body: { code: code.trim().toUpperCase() } });
        const asObserver = joined.role === 'observer';
        const pending = joined.status === 'pending';
        setResult({
          projectId: joined.projectId,
          title: pending ? 'Almost there' : `Welcome, ${firstName}`,
          sub: asObserver
            ? 'You are the observer. You will see what changed, what is happening now and what comes next, in plain language.'
            : pending
              ? 'Your admin request was sent. The project owner needs to approve it before you can start.'
              : 'You joined the project.',
          steps: asObserver
            ? ['See how the website looks right now', 'Read what changed and why', 'Ask the admins for a change if something is missing']
            : ['Wait for the owner to approve you', 'Add workers to the project', 'Assign tasks and review merge requests'],
        });
      }
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      top={(
        <button type="button" onClick={signOut} className={`inline-flex min-h-11 cursor-pointer items-center border-0 bg-transparent p-0 text-sm font-semibold text-dim underline ${focusRing}`}>
          Sign out
        </button>
      )}
    >
      {result ? (
        <Done result={result} onContinue={() => navigate('/projects', { replace: true })} />
      ) : (
        <>
          <h1 className={heading}>How will you use Buildify?</h1>
          <p className={subheading}>Your account is ready. Choose your role to finish setup.</p>
          <Alert tone="error">{formError}</Alert>
          <form onSubmit={onSubmit} noValidate>
            <fieldset className="m-0 mb-[18px] grid grid-cols-1 gap-2.5 border-0 p-0 min-[400px]:grid-cols-2">
              <legend className="mb-2 p-0 text-sm font-semibold">I am joining as</legend>
              {ROLES.map((r) => (
                <RoleCard key={r.id} role={r} checked={role === r.id} onChange={() => setRole(r.id)} />
              ))}
            </fieldset>

            {role === 'founder' ? (
              <Field
                ref={wsRef}
                label="Workspace name"
                placeholder="LedgerLite"
                value={workspace}
                onChange={(e) => setWorkspace(e.target.value)}
                hint="This is the shared space your team and agents will work in."
                error={errors.workspace}
              />
            ) : (
              <Field
                ref={codeRef}
                label="Invite code"
                placeholder="ADM-7K2QXM9P"
                autoCapitalize="characters"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                hint="Admins get an ADM- code from the project owner. Observers get an OBS- code. Workers are added by an admin, no code needed."
                error={errors.code}
              />
            )}

            <button type="submit" className={primaryButton} disabled={busy}>
              {busy ? 'Setting up…' : 'Continue'}
            </button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}

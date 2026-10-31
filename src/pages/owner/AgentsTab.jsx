// The owner's own Builder and Critic. The Builder proposes, the Critic reviews, and
// nothing reaches the project until the work is sent for review and approved.
import { useState } from 'react';
import { api } from '../../services/apiClient';
import { useOwner } from '../../features/projects/ownerContext';
import { useProjectResource } from '../../features/projects/useProjectResource';
import AgentStatus from '../../components/agents/AgentStatus';
import ActionButton from '../../components/common/ActionButton';
import Alert from '../../components/common/Alert';
import Badge from '../../components/common/Badge';
import Field from '../../components/common/Field';
import PageHeader from '../../components/common/PageHeader';
import TextArea from '../../components/common/TextArea';
import { card, quietButton, sectionTitle, solidButton } from '../../components/common/styles';

const STATES = {
  draft: { label: 'Draft', tone: 'neutral' },
  reviewed: { label: 'Reviewed by Critic', tone: 'accent' },
  submitted: { label: 'Waiting for review', tone: 'accent' },
  approved: { label: 'Approved', tone: 'accent' },
  rejected: { label: 'Rejected', tone: 'err' },
  redirected: { label: 'Sent back', tone: 'warn' },
  stale: { label: 'Out of date', tone: 'err' },
};
const SEVERITY_TONE = { high: 'err', medium: 'warn', low: 'neutral' };

function CriticReview({ review }) {
  return (
    <div className="mt-3 rounded-lg border border-line bg-bg p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Critic: {review.verdict}</span>
        <span className="font-mono text-xs text-dim">{review.score}/100</span>
      </div>
      {review.summary && <p className="m-0 mt-1 text-sm">{review.summary}</p>}
      {review.issues?.length > 0 && (
        <ul className="m-0 mt-2 list-none space-y-2 p-0">
          {review.issues.map((issue) => (
            <li key={`${issue.path}-${issue.message}`} className="text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={SEVERITY_TONE[issue.severity]}>{issue.severity}</Badge>
                {issue.path && <code className="font-mono text-xs break-all text-dim">{issue.path}</code>}
              </div>
              <p className="m-0 mt-0.5">{issue.message}</p>
              {issue.suggestion && <p className="m-0 text-[13px] text-dim">{issue.suggestion}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Proposal({ proposal, onReview, onSubmit, onRerun }) {
  const state = STATES[proposal.status] || STATES.draft;
  const open = ['draft', 'reviewed'].includes(proposal.status);
  return (
    <li className={`${card} p-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={state.tone}>{state.label}</Badge>
        <span className="font-mono text-xs text-dim">based on v{proposal.base_version}</span>
      </div>
      <p className="m-0 mt-2 font-semibold">{proposal.summary}</p>
      {proposal.reason && <p className="m-0 mt-0.5 text-sm text-dim">{proposal.reason}</p>}
      <ul className="m-0 mt-2 list-none space-y-0.5 p-0 font-mono text-xs text-dim">
        {proposal.changes.map((change) => <li key={change.path} className="break-all">{change.action} {change.path}</li>)}
      </ul>
      {proposal.stale_reason && <p className="m-0 mt-2 text-sm text-err">{proposal.stale_reason}</p>}
      {proposal.review && <CriticReview review={proposal.review} />}
      {open && (
        <div className="mt-3 flex flex-wrap gap-1">
          <ActionButton onAction={() => onReview(proposal.id)}>{proposal.review ? 'Review again' : 'Ask Critic'}</ActionButton>
          <ActionButton variant="quiet" onAction={() => onSubmit(proposal.id)}>Send for review</ActionButton>
        </div>
      )}
      {proposal.status === 'stale' && (
        <div className="mt-3"><button type="button" className={quietButton} onClick={() => onRerun(proposal.instruction)}>Use this instruction again</button></div>
      )}
    </li>
  );
}

function ContextPanel() {
  const context = useProjectResource('moderator/context');
  const c = context.data;
  const others = c?.activeWorkByOthers || [];
  const facts = c ? [
    ['Approved version', `v${c.version}`],
    ['Requirements', Object.keys(c.brief || {}).length],
    ['Files it can see', c.fileIndex.length],
    ['Recent changes', c.recentChanges.length],
    ['Others working now', others.length],
  ] : [];

  return (
    <section>
      <h2 className={`${sectionTitle} mb-2`}>What your Builder knows</h2>
      <div className={`${card} p-4`}>
        <p className="m-0 text-sm text-dim">Rebuilt from the approved record before every run, so a restarted agent picks up exactly where the project is.</p>
        <Alert tone="error">{context.error}</Alert>
        <dl className="m-0 mt-3 divide-y divide-line">
          {facts.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 py-1.5 text-sm">
              <dt className="text-dim">{label}</dt>
              <dd className="m-0 font-mono">{value}</dd>
            </div>
          ))}
        </dl>
        {others.length > 0 && (
          <ul className="m-0 mt-2 list-disc space-y-0.5 pl-5 text-[13px] text-dim">
            {others.map((work) => <li key={work.intentId}>{work.who}: {work.goal}</li>)}
          </ul>
        )}
      </div>
    </section>
  );
}

export default function AgentsTab() {
  const { projectId, me, reload } = useOwner();
  const proposals = useProjectResource('agents/proposals');
  const [instruction, setInstruction] = useState('');
  const [targets, setTargets] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [overlap, setOverlap] = useState('');

  async function refresh() {
    await Promise.all([proposals.reload(), reload()]);
  }

  async function runBuilder(force = false) {
    if (!instruction.trim()) return setError('Tell your Builder what to do first.');
    setRunning(true);
    setError('');
    setOverlap('');
    try {
      await api('agents/builder/run', { method: 'POST', body: { projectId, instruction: instruction.trim(), targets, force } });
      setInstruction('');
      setTargets('');
      await refresh();
    } catch (err) {
      if (err.status === 409 && err.details?.overlap) setOverlap(err.message);
      else if (err.status === 422) setError(`${err.message} Missing: ${(err.details?.missing || []).join(', ')}`);
      else setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  async function step(action) {
    setError('');
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  const askCritic = (proposalId) => step(() => api('agents/critic/review', { method: 'POST', body: { proposalId } }));
  const send = (proposalId) => step(() => api('reviews/submit', { method: 'POST', body: { projectId, proposalIds: [proposalId] } }));
  const list = proposals.data?.proposals;

  function onSubmit(e) {
    e.preventDefault();
    runBuilder();
  }

  return (
    <>
      <PageHeader title="My agents">You have your own Builder and Critic. Your changes go through the same review as everyone else's.</PageHeader>

      <div className="grid gap-7 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-7">
          <form onSubmit={onSubmit} className={`${card} p-4`}>
            <TextArea label="Give your Builder a job" rows={3} placeholder="Add a monthly and yearly switch to the pricing page" value={instruction} onChange={(e) => { setInstruction(e.target.value); setError(''); }} />
            <Field
              label="Files it should touch"
              hint="Optional. Separate paths with commas, so other agents can see what you are working on."
              placeholder="src/pages/Pricing.jsx, src/components/Toggle.jsx"
              value={targets}
              onChange={(e) => setTargets(e.target.value)}
            />
            <Alert tone="error">{error || proposals.error}</Alert>
            {overlap && (
              <div className="mb-4 rounded-lg border-[1.5px] border-mark px-3.5 py-3 text-sm">
                <p className="m-0">{overlap}</p>
                <div className="mt-2"><ActionButton onAction={() => runBuilder(true)}>Run anyway</ActionButton></div>
              </div>
            )}
            <button type="submit" className={solidButton} disabled={running}>{running ? 'Your Builder is working…' : 'Run Builder'}</button>
          </form>

          <section>
            <h2 className={`${sectionTitle} mb-2`}>Your proposals</h2>
            {list?.length === 0 && <p className={`${card} m-0 px-4 py-6 text-center text-sm text-dim`}>What your Builder proposes shows up here. Nothing goes live until it is approved.</p>}
            {list?.length > 0 && (
              <ol className="m-0 list-none space-y-3 p-0">
                {list.map((proposal) => (
                  <Proposal key={proposal.id} proposal={proposal} onReview={askCritic} onSubmit={send} onRerun={setInstruction} />
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="min-w-0 space-y-7">
          <section>
            <h2 className={`${sectionTitle} mb-2`}>Status</h2>
            <div className={`${card} px-4 py-3`}><AgentStatus agents={me?.agents} /></div>
          </section>
          <ContextPanel />
        </div>
      </div>
    </>
  );
}

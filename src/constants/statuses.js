// Work status (bottom bar), agent steps, and submission statuses.

export function workStatus(task, submission, outdated) {
  if (!task || task.status === 'cancelled') return 'Draft';
  switch (task.status) {
    case 'reading_context': case 'checking_conflicts': case 'planning': case 'working': case 'reviewing': return 'Agent working';
    case 'needs_conflict_decision': case 'awaiting_plan_approval': case 'needs_context_decision': case 'needs_action_approval': case 'failed': return 'Needs your decision';
    case 'done': return outdated ? 'Outdated' : 'Ready to submit';
    case 'submitted': return submission?.outdated?.length ? 'Outdated' : 'Submitted';
    case 'approved': return 'Approved';
    case 'sent_back': return 'Sent back';
    case 'rejected': return 'Rejected';
    default: return 'Draft';
  }
}

export const WORK_STATUS_TONE = {
  Draft: 'slate', 'Agent working': 'blue', 'Needs your decision': 'amber', 'Ready to submit': 'green',
  Submitted: 'violet', Approved: 'green', 'Sent back': 'amber', Rejected: 'red', Outdated: 'red',
};

export const AGENT_STEPS = [
  { key: 'read', label: 'Reading context', statuses: ['reading_context'] },
  { key: 'check', label: 'Checking for conflicts', statuses: ['checking_conflicts', 'needs_conflict_decision'] },
  { key: 'plan', label: 'Waiting for plan approval', statuses: ['planning', 'awaiting_plan_approval'] },
  { key: 'work', label: 'Builder making changes', statuses: ['working', 'needs_action_approval'] },
  { key: 'review', label: 'Critic reviewing', statuses: ['reviewing'] },
  { key: 'done', label: 'Done', statuses: ['done', 'needs_context_decision', 'submitted', 'approved', 'sent_back', 'rejected'] },
];

export const SUB_STATUS = {
  pending: { label: 'Waiting for review', tone: 'violet' },
  approved: { label: 'Approved', tone: 'green' },
  sent_back: { label: 'Sent back', tone: 'amber' },
  rejected: { label: 'Rejected', tone: 'red' },
  merge_conflict: { label: 'Merge conflict', tone: 'red' },
};

export const scopeName = (scope) => (scope === 'central' ? 'Central' : scope.charAt(0).toUpperCase() + scope.slice(1));

// Context item kinds: the plan (what is required) and progress (what is built).
export const KIND_LABEL = {
  goal: 'Goal', must_do: 'Must do', must_not: 'Must not', decision: 'Decision', done: 'Definition of done',
  progress: 'Progress', checkpoint: 'Checkpoint', note: 'Note',
};

// Where a suggestion is: applied directly, waiting for a person, or decided.
export const SUGGESTION_STATUS = {
  applied: { label: 'Applied directly', tone: 'green' },
  pending_manager: { label: 'Waiting for department manager', tone: 'amber' },
  pending_founder: { label: 'Waiting for founder', tone: 'violet' },
  approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
  workaround: { label: 'Resolved with a workaround', tone: 'blue' },
  sent_back: { label: 'Sent back to re-check', tone: 'amber' },
  blocked: { label: 'Blocked', tone: 'red' },
  withdrawn: { label: 'Withdrawn', tone: 'slate' },
  reverted: { label: 'Reverted', tone: 'slate' },
};

export const SUGGESTION_LABEL = {
  progress: 'Progress', plan_change: 'Plan change', conflict: 'Conflict', large_change: 'Large change', checkpoint: 'Checkpoint',
  unchecked: 'Needs a check', revert: 'Revert',
};

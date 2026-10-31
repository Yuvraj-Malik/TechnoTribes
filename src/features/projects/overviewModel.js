// Turns raw project data into what the owner should see first. No React here,
// so tests/unit can check these rules directly.
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

export const firstName = (name) => String(name || 'Someone').trim().split(/\s+/)[0];

function listNames(names) {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length < 2) return unique[0] || 'Your team';
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
}

// Admins handle everyday reviews. The owner sees clashes, work that fell out of
// date, and anything only they can decide. With no admin, all reviews come here.
export function buildNeedsYou({ members = [], joinRequests = [], queue = {}, requests = [] }) {
  const items = [];
  const hasAdmin = members.some((m) => m.role === 'admin' && m.status === 'active');
  let withAdmins = 0;

  for (const mr of queue.needsAttention || []) {
    items.push({
      id: `outdated-${mr.id}`,
      kind: 'outdated',
      tone: 'err',
      label: 'Out of date',
      text: `${mr.submittedByName || 'A team member'}'s work needs a re-run. ${mr.conflict_reason || ''}`.trim(),
    });
  }

  for (const bucket of queue.buckets || []) {
    const inBucket = bucket.mergeRequests || [];
    if (inBucket.length > 1) {
      items.push({
        id: `clash-${bucket.id}`,
        kind: 'clash',
        tone: 'warn',
        label: 'Clash',
        text: `${listNames(inBucket.map((mr) => mr.submittedByName))} sent ${bucket.label}. Only one can go in first.`,
        mergeRequests: inBucket,
      });
    } else if (inBucket.length === 1 && hasAdmin) {
      withAdmins += 1;
    } else if (inBucket.length === 1) {
      const [mr] = inBucket;
      items.push({
        id: `review-${mr.id}`,
        kind: 'review',
        tone: 'accent',
        label: 'Review',
        text: `${mr.submittedByName || 'A team member'}: ${mr.proposals?.[0]?.summary || bucket.label}`,
        mergeRequests: inBucket,
      });
    }
  }

  for (const m of members) {
    if (m.role === 'admin' && m.status === 'pending') {
      items.push({
        id: `admin-${m.user_id}`,
        kind: 'admin',
        tone: 'accent',
        label: 'New admin',
        text: `${m.name || 'Someone'} used an admin code and needs your approval.`,
        userId: m.user_id,
      });
    }
  }

  for (const r of joinRequests) {
    items.push({
      id: `join-${r.id}`,
      kind: 'join',
      tone: 'accent',
      label: 'Wants to join',
      text: `${r.name || 'Someone'} asked to join as an engineer${r.message ? `: "${r.message}"` : '.'}`,
      requestId: r.id,
    });
  }

  for (const r of requests) {
    if (r.status === 'pending') {
      items.push({ id: `investor-${r.id}`, kind: 'investor', tone: 'accent', label: 'Investor', text: `Asked for: ${r.message}`, requestId: r.id });
    }
  }

  return { items, withAdmins };
}

export function statusLine({ members = [], needsYouCount = 0, withAdmins = 0 }) {
  const working = members.flatMap((m) => m.agents || []).filter((a) => a.status === 'working').length;
  const parts = [
    working ? `${plural(working, 'agent')} ${working === 1 ? 'is' : 'are'} working.` : 'No agents are working right now.',
    needsYouCount ? `${plural(needsYouCount, 'item')} ${needsYouCount === 1 ? 'needs' : 'need'} you.` : 'Nothing needs you.',
  ];
  if (withAdmins) parts.push(`${plural(withAdmins, 'change')} ${withAdmins === 1 ? 'is' : 'are'} with your admins.`);
  return parts.join(' ');
}

// The org chart: the owner, each admin with their team, and anyone not on a team yet.
export function buildOrg(members = []) {
  const active = members.filter((m) => m.status === 'active');
  const admins = active.filter((m) => m.role === 'admin');
  const workers = active.filter((m) => m.role === 'worker');
  const adminIds = new Set(admins.map((a) => a.user_id));
  return {
    owner: active.find((m) => m.role === 'owner') || null,
    investor: active.find((m) => m.role === 'observer') || null,
    teams: admins.map((lead) => ({
      lead,
      name: lead.team || `${firstName(lead.name)}'s team`,
      people: workers.filter((w) => w.lead_id === lead.user_id),
    })),
    unassigned: workers.filter((w) => !adminIds.has(w.lead_id)),
  };
}

export function agentLine(agent) {
  const name = agent.kind === 'builder' ? 'Builder' : 'Critic';
  if (agent.status === 'working') {
    // The Critic's activity already starts with "Reviewing: ", from server/agents/critic.js.
    return `${name}: ${(agent.current_activity || 'working').replace(/^Reviewing: /, 'reviewing ')}`;
  }
  return `${name}: ${agent.status === 'blocked' ? 'blocked' : 'idle'}`;
}

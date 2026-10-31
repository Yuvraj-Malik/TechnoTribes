// The first screen: how the project stands, what needs the owner, and who is on it.
import { Link } from 'react-router-dom';
import { useOwner } from '../../features/projects/ownerContext';
import { buildOrg, statusLine } from '../../features/projects/overviewModel';
import AgentStatus from '../../components/agents/AgentStatus';
import Avatar from '../../components/common/Avatar';
import PageHeader from '../../components/common/PageHeader';
import { card, focusRing, sectionTitle } from '../../components/common/styles';
import NeedsYouList from '../../components/reviews/NeedsYouList';
import RecentChanges from '../../components/timeline/RecentChanges';

function Section({ title, link, children }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className={sectionTitle}>{title}</h2>
        {link && <Link to={link.to} className={`inline-flex items-center text-[13px] font-medium text-accent max-lg:min-h-11 ${focusRing}`}>{link.label}</Link>}
      </div>
      {children}
    </section>
  );
}

function Stats({ items }) {
  return (
    <dl className={`${card} m-0 mb-7 grid grid-cols-2 sm:grid-cols-4`}>
      {items.map((item, i) => (
        <div key={item.label} className={`px-4 py-3 ${i ? 'border-l border-line' : ''} ${i === 2 ? 'max-sm:border-t max-sm:border-l-0' : ''} ${i === 3 ? 'max-sm:border-t' : ''}`}>
          <dd className="m-0 font-display text-2xl font-bold">{item.value}</dd>
          <dt className="text-[13px] text-dim">{item.label}</dt>
        </div>
      ))}
    </dl>
  );
}

function TeamRows({ org, colors }) {
  if (!org.teams.length && !org.unassigned.length) {
    return <p className={`${card} m-0 px-4 py-6 text-center text-sm text-dim`}>Admins and their teams will show up here.</p>;
  }
  const working = (people) => {
    const count = people.flatMap((p) => p.agents || []).filter((a) => a.status === 'working').length;
    return `${count} ${count === 1 ? 'agent' : 'agents'} working`;
  };
  return (
    <ul className={`${card} m-0 list-none divide-y divide-line p-0`}>
      {org.teams.map((team) => (
        <li key={team.lead.user_id} className="flex items-center gap-3 px-4 py-3">
          <Avatar name={team.lead.name} color={colors[team.lead.user_id]} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{team.name}</div>
            <div className="truncate text-[13px] text-dim">Led by {team.lead.name}</div>
          </div>
          <div className="text-right text-[13px] whitespace-nowrap text-dim">
            <div>{team.people.length} {team.people.length === 1 ? 'person' : 'people'}</div>
            <div>{working([team.lead, ...team.people])}</div>
          </div>
        </li>
      ))}
      {org.unassigned.length > 0 && (
        <li className="px-4 py-3 text-[13px] text-dim">
          {org.unassigned.length} {org.unassigned.length === 1 ? 'engineer is' : 'engineers are'} not on a team yet
        </li>
      )}
    </ul>
  );
}

export default function OverviewTab() {
  const { data, projectId, base, me, version, needsYou, withAdmins, colors, act, decide } = useOwner();
  const { project, members, queue, log } = data;
  const org = buildOrg(members);
  const inReview = (queue.buckets || []).reduce((sum, b) => sum + (b.mergeRequests?.length || 0), 0);
  const working = members.flatMap((m) => m.agents || []).filter((a) => a.status === 'working').length;

  return (
    <>
      <PageHeader title={project.name}>{statusLine({ members, needsYouCount: needsYou.length, withAdmins })}</PageHeader>
      <Stats
        items={[
          { label: 'Approved version', value: `v${version}` },
          { label: 'Agents working', value: working },
          { label: 'Waiting for review', value: inReview },
          { label: 'Out of date', value: queue.needsAttention?.length || 0 },
        ]}
      />

      <div className="grid gap-7 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-7">
          <Section title="Needs you">
            <NeedsYouList
              items={needsYou}
              onAdmin={(userId, approve) => act('projects/admins/approve', { projectId, userId, approve })}
              onJoin={(requestId, accept) => act('projects/join-request/respond', { requestId, accept })}
              onDecide={decide}
            />
          </Section>
          <Section title="Admins and teams" link={{ to: `${base}/team`, label: 'See everyone' }}>
            <TeamRows org={org} colors={colors} />
          </Section>
        </div>
        <div className="grid min-w-0 content-start gap-7 md:grid-cols-2 xl:grid-cols-1">
          <Section title="Your agents" link={{ to: `${base}/agents`, label: 'Open' }}>
            <div className={`${card} px-4 py-3`}><AgentStatus agents={me?.agents} /></div>
          </Section>
          <Section title="Latest approved" link={{ to: `${base}/code`, label: 'See code' }}>
            <RecentChanges entries={log.slice(0, 4)} />
          </Section>
        </div>
      </div>
    </>
  );
}

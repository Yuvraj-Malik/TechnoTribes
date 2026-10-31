// Everyone on the project: the owner, each admin with their team, and what each
// person does. Managers can set a designation and who someone reports to.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useOwner } from '../../features/projects/ownerContext';
import { buildOrg } from '../../features/projects/overviewModel';
import AgentStatus from '../../components/agents/AgentStatus';
import Avatar from '../../components/common/Avatar';
import Badge from '../../components/common/Badge';
import Field from '../../components/common/Field';
import PageHeader from '../../components/common/PageHeader';
import { card, focusRing, outlineButton, quietButton, sectionTitle } from '../../components/common/styles';

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', worker: 'Engineer', observer: 'Investor' };

function EditMember({ person, admins, onSave, onCancel }) {
  const [designation, setDesignation] = useState(person.designation || '');
  const [team, setTeam] = useState(person.team || '');
  const [leadId, setLeadId] = useState(person.lead_id || '');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    const changes = { designation };
    if (person.role === 'admin') changes.team = team;
    if (person.role === 'worker') changes.leadId = leadId;
    await onSave(changes);
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 rounded-lg border border-line bg-bg p-3">
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label="Designation" placeholder="Frontend engineer" value={designation} onChange={(e) => setDesignation(e.target.value)} />
        {person.role === 'admin' && (
          <Field label="Team name" placeholder="Frontend" value={team} onChange={(e) => setTeam(e.target.value)} />
        )}
        {person.role === 'worker' && (
          <div className="mb-3.5">
            <label htmlFor={`lead-${person.user_id}`} className="mb-1.5 block text-sm font-semibold">Reports to</label>
            <select
              id={`lead-${person.user_id}`}
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              className={`w-full rounded-lg border-[1.5px] border-line bg-surface px-3 py-3 font-sans text-base text-ink ${focusRing}`}
            >
              <option value="">Not on a team</option>
              {admins.map((admin) => <option key={admin.user_id} value={admin.user_id}>{admin.name}</option>)}
            </select>
          </div>
        )}
      </div>
      <div className="flex gap-1">
        <button type="submit" disabled={busy} className={outlineButton}>Save</button>
        <button type="button" className={quietButton} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function Person({ person, color, admins, onSave, lead = false }) {
  const [editing, setEditing] = useState(false);
  const label = person.name || 'Unnamed';

  async function save(changes) {
    if (await onSave(person.user_id, changes)) setEditing(false);
  }

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <Avatar name={person.name} color={color} className={lead ? 'size-10' : 'size-8'} />
        <div className="min-w-44 flex-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="font-semibold">{label}</span>
            <Badge>{ROLE_LABEL[person.role]}</Badge>
          </div>
          <div className="text-sm text-dim">{person.designation || 'No designation yet'}</div>
        </div>
        <div className="min-w-48 flex-1"><AgentStatus agents={person.agents} /></div>
        <button type="button" aria-label={`Edit ${label}`} aria-expanded={editing} className={quietButton} onClick={() => setEditing(!editing)}>
          {editing ? 'Close' : 'Edit'}
        </button>
      </div>
      {editing && <EditMember person={person} admins={admins} onSave={save} onCancel={() => setEditing(false)} />}
    </li>
  );
}

export default function TeamTab() {
  const { data, projectId, base, colors, act } = useOwner();
  const org = buildOrg(data.members);
  const admins = org.teams.map((team) => team.lead);
  const pending = data.members.filter((m) => m.status === 'pending');
  const save = (userId, changes) => act('projects/members/update', { projectId, userId, ...changes });
  const rowProps = { admins, onSave: save };
  const headcount = data.members.filter((m) => m.status === 'active' && m.role !== 'observer').length;

  return (
    <>
      <PageHeader title="Team">
        {headcount} {headcount === 1 ? 'person' : 'people'}, {org.teams.length} {org.teams.length === 1 ? 'team' : 'teams'}. Everyone has their own Builder and Critic.
      </PageHeader>

      <div className="space-y-6">
        {org.owner && (
          <section aria-label="Project owner">
            <ul className={`${card} m-0 list-none p-0`}>
              <Person person={org.owner} color={colors[org.owner.user_id]} lead {...rowProps} />
            </ul>
          </section>
        )}

        {org.teams.map((team) => (
          <section key={team.lead.user_id} aria-label={team.name}>
            <div className="mb-2 flex items-baseline gap-2">
              <h2 className={sectionTitle}>{team.name}</h2>
              <span className="text-[13px] text-dim">{team.people.length + 1} people</span>
            </div>
            <ul className={`${card} m-0 list-none divide-y divide-line p-0`}>
              <Person person={team.lead} color={colors[team.lead.user_id]} lead {...rowProps} />
              {team.people.map((person) => <Person key={person.user_id} person={person} color={colors[person.user_id]} {...rowProps} />)}
              {!team.people.length && <li className="px-4 py-3 text-sm text-dim">No engineers on this team yet. Open an engineer and choose who they report to.</li>}
            </ul>
          </section>
        ))}

        {!org.teams.length && (
          <p className={`${card} m-0 px-6 py-8 text-center text-sm text-dim`}>
            No admins yet. <Link to={`${base}/settings`} className="font-semibold text-accent">Create an admin code in Settings</Link>
          </p>
        )}

        {org.unassigned.length > 0 && (
          <section aria-label="Not on a team yet">
            <h2 className={`${sectionTitle} mb-2`}>Not on a team yet</h2>
            <ul className={`${card} m-0 list-none divide-y divide-line p-0`}>
              {org.unassigned.map((person) => <Person key={person.user_id} person={person} color={colors[person.user_id]} {...rowProps} />)}
            </ul>
          </section>
        )}

        {(pending.length > 0 || org.investor) && (
          <section aria-label="Others">
            <h2 className={`${sectionTitle} mb-2`}>Others</h2>
            <ul className={`${card} m-0 list-none divide-y divide-line p-0`}>
              {pending.map((person) => (
                <li key={person.user_id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={person.name} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{person.name || 'Unnamed'}</span>
                  <Badge tone="warn">Waiting for your approval</Badge>
                </li>
              ))}
              {org.investor && (
                <li className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={org.investor.name} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{org.investor.name || 'Unnamed'}</span>
                  <Badge>Investor</Badge>
                </li>
              )}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}

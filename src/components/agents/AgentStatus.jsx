// One line per agent: a live dot, then what it is doing.
import { agentLine } from '../../features/projects/overviewModel';

const DOTS = { working: 'bg-pip-ok', blocked: 'bg-err', idle: 'bg-dim/40' };

export default function AgentStatus({ agents = [] }) {
  const sorted = [...agents].sort((a, b) => a.kind.localeCompare(b.kind));
  return (
    <ul className="m-0 list-none space-y-0.5 p-0">
      {sorted.map((agent) => (
        <li key={agent.id} className="flex items-baseline gap-2 text-sm text-dim">
          <span aria-hidden="true" className={`inline-block size-2 flex-none -translate-y-px rounded-full ${DOTS[agent.status] || DOTS.idle}`} />
          <span className="min-w-0 break-words">{agentLine(agent)}</span>
        </li>
      ))}
    </ul>
  );
}

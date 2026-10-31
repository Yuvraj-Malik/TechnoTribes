// Each person's goal and what they have finished so far. Picking a card focuses
// the views above on that person.
import Avatar from '../common/Avatar';
import Icon from '../common/Icon';
import { card, focusRing } from '../common/styles';

const MAX_SHIPPED = 3;

function Person({ person, color, active, onFocus }) {
  const { name, designation, goal, tasksDone, tasksTotal, progress, shipped, openTasks } = person;
  return (
    <article className={`${card} flex flex-col p-4 ${active ? 'border-accent' : ''}`}>
      <button
        type="button"
        aria-pressed={active}
        title={active ? 'Show everyone' : `Show only ${name}`}
        onClick={onFocus}
        className={`flex min-h-11 w-full cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-left text-ink ${focusRing}`}
      >
        <Avatar name={name} color={color} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{name}</span>
          <span className="block truncate text-[13px] text-dim">{designation || 'No designation yet'}</span>
        </span>
      </button>

      <div className="mt-3">
        <div className="text-xs font-medium text-dim">Goal</div>
        <p className="m-0 text-sm">{goal || 'Nothing in progress'}</p>
      </div>

      {tasksTotal > 0 && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-dim">
            <span>{tasksDone} of {tasksTotal} tasks done</span>
            <span>{progress}%</span>
          </div>
          <div
            role="progressbar"
            aria-label={`${name}'s tasks`}
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 overflow-hidden rounded-full bg-ink/10"
          >
            <div className="h-full rounded-full" style={{ width: `${progress}%`, backgroundColor: color || 'var(--accent)' }} />
          </div>
        </div>
      )}

      <div className="mt-3">
        <div className="text-xs font-medium text-dim">Done so far</div>
        {shipped.length ? (
          <ul className="m-0 mt-1 list-none space-y-1 p-0">
            {shipped.slice(0, MAX_SHIPPED).map((entry) => (
              <li key={entry.version} className="flex items-start gap-1.5 text-sm">
                <Icon name="check" className="mt-0.5 size-4 text-ok" />
                <span className="min-w-0"><code className="font-mono text-xs text-dim">v{entry.version}</code> {entry.summary}</span>
              </li>
            ))}
            {shipped.length > MAX_SHIPPED && <li className="pl-5.5 text-[13px] text-dim">and {shipped.length - MAX_SHIPPED} more</li>}
          </ul>
        ) : (
          <p className="m-0 text-sm text-dim">Nothing approved yet</p>
        )}
      </div>

      {openTasks.length > 1 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-dim">Up next</div>
          <p className="m-0 text-sm">{openTasks[1].title}</p>
        </div>
      )}
    </article>
  );
}

export default function PeopleProgress({ people, colors, focus, onFocus }) {
  if (!people.length) return null;
  return (
    <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {people.map((person) => (
        <Person
          key={person.userId}
          person={person}
          color={colors[person.userId]}
          active={focus === person.userId}
          onFocus={() => onFocus(focus === person.userId ? null : person.userId)}
        />
      ))}
    </div>
  );
}

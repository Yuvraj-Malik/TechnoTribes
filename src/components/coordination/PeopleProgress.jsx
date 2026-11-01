// Each person's goal and what they have finished so far.
import { Avatar, colorFor } from '../common/ui';
import { RoleBadge } from '../dashboard/ui';
import Icon from '../common/Icon';

const MAX_SHIPPED = 3;

function Person({ person }) {
  const { userId, name, role, designation, goal, upNext, tasksDone, tasksTotal, progress, shipped } = person;
  return (
    <article className="flex flex-col rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2.5">
        <Avatar person={{ id: userId, name }} size={34} />
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-sm font-semibold text-ink">{name}</p>
          <p className="m-0 truncate text-[13px] text-dim">{designation || 'No title yet'}</p>
        </div>
        <RoleBadge role={role} />
      </div>

      <div className="mt-3">
        <div className="text-xs font-medium text-dim">Goal</div>
        <p className="m-0 text-sm text-ink">{goal || 'Nothing in progress'}</p>
      </div>

      {tasksTotal > 0 && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-dim">
            <span>{tasksDone} of {tasksTotal} tasks done</span>
            <span>{progress}%</span>
          </div>
          <div role="progressbar" aria-label={`${name}'s tasks`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} className="h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full" style={{ width: `${progress}%`, backgroundColor: colorFor(userId) }} />
          </div>
        </div>
      )}

      <div className="mt-3">
        <div className="text-xs font-medium text-dim">Done so far</div>
        {shipped.length ? (
          <ul className="m-0 mt-1 list-none space-y-1 p-0">
            {shipped.slice(0, MAX_SHIPPED).map((entry) => (
              <li key={entry.id} className="flex items-start gap-1.5 text-sm text-ink">
                <Icon name="check" size={16} className="mt-0.5 text-ok" />
                <span className="min-w-0">{entry.title}</span>
              </li>
            ))}
            {shipped.length > MAX_SHIPPED && <li className="pl-5.5 text-[13px] text-dim">and {shipped.length - MAX_SHIPPED} more</li>}
          </ul>
        ) : <p className="m-0 text-sm text-dim">Nothing approved yet</p>}
      </div>

      {upNext && (
        <div className="mt-3">
          <div className="text-xs font-medium text-dim">Up next</div>
          <p className="m-0 text-sm text-ink">{upNext}</p>
        </div>
      )}
    </article>
  );
}

export default function PeopleProgress({ people }) {
  return (
    <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {people.map((person) => <Person key={person.userId} person={person} />)}
    </div>
  );
}

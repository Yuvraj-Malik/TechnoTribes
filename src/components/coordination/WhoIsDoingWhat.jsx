// One row per person: their pieces of work, and what they do next.
import { Avatar, cx } from '../common/ui';
import { timeAgo } from '../../utils/time';
import { WORK_LOOK, WorkLegend } from './WorkWall';

const waitingWords = (since) => {
  const ago = timeAgo(since);
  return ago === 'just now' ? 'Just now' : `Waiting ${ago.replace(' ago', '')}`;
};

function Person({ person }) {
  const { userId, name, title, pieces, next, rules } = person;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line py-3 last:pb-0">
      <div className="flex min-w-0 flex-[1_1_200px] items-center gap-2.5">
        <Avatar person={{ id: userId, name }} size={34} />
        <div className="min-w-0">
          <p className="m-0 truncate text-sm font-semibold text-ink">{name}</p>
          <p className="m-0 truncate text-[13px] text-dim">{title}</p>
        </div>
      </div>
      <div className="flex min-w-0 flex-[2_1_280px] flex-wrap gap-1">
        {pieces.map((piece) => {
          const look = WORK_LOOK[piece.stage];
          return (
            <span key={piece.id} title={`${piece.title}: ${look.label.toLowerCase()}`} style={look.style} className={cx('line-clamp-2 max-w-52 rounded-md px-2.5 py-1.5 text-[13px] leading-tight font-semibold', look.className)}>
              {piece.title}
            </span>
          );
        })}
        {!pieces.length && (
          <p className="m-0 text-sm text-dim">
            {rules ? `Sets the rules the AI agents follow. ${rules} ${rules === 1 ? 'change' : 'changes'} so far.` : 'No pieces of work yet.'}
          </p>
        )}
      </div>
      <div className="min-w-0 flex-[1_1_200px] text-sm">
        {next ? (
          <>
            <p className="m-0 font-semibold text-ink">{next.words}</p>
            <p className="m-0 text-[13px] text-dim">{waitingWords(next.since)}</p>
          </>
        ) : <p className="m-0 text-dim">Nothing waiting</p>}
      </div>
    </li>
  );
}

export default function WhoIsDoingWhat({ people }) {
  return (
    <>
      <WorkLegend className="mb-3" />
      <ul className="m-0 list-none p-0">{people.map((person) => <Person key={person.userId} person={person} />)}</ul>
    </>
  );
}

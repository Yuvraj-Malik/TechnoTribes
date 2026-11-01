// The work as a brick wall that rises as pieces go live. One brick is one piece of
// work: solid is live, striped is being finished, dashed has not started.
import { useState } from 'react';
import { Avatar, Badge, cx } from '../common/ui';
import { focusRing } from '../common/styles';
import WhatWhy from '../timeline/WhatWhy';
import { useElementWidth } from '../../hooks/useElementWidth';
import { BRICK_GAP, brickSize, wallLayout, wallRows } from '../../features/observer/progressModel';

const STRIPES = 'repeating-linear-gradient(135deg, rgba(42, 29, 0, 0.09) 0 7px, transparent 7px 14px)';

export const WORK_LOOK = {
  done: { className: 'border-0 bg-ok text-accent-ink', label: 'Live' },
  now: { className: 'border-0 bg-mark text-[#2a1d00]', style: { backgroundImage: STRIPES }, label: 'Being finished' },
  upcoming: { className: 'border-[1.5px] border-dashed border-dim bg-transparent text-ink', label: 'Not started' },
};

export function WorkLegend({ counts, className }) {
  return (
    <ul className={cx('m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[13px] text-dim', className)}>
      {Object.entries(WORK_LOOK).map(([stage, look]) => (
        <li key={stage} className="flex items-center gap-1.5">
          <span className={cx('h-2.5 w-3.5 rounded-[3px]', look.className)} style={look.style} aria-hidden="true" />
          {counts && <span className="font-semibold text-ink">{counts[stage]}</span>}
          <span>{look.label.toLowerCase()}</span>
        </li>
      ))}
    </ul>
  );
}

function Brick({ piece, named, picked, onPick, style }) {
  const look = WORK_LOOK[piece.stage];
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={picked}
      aria-label={`${piece.title}. ${piece.who}. ${piece.statusWords}`}
      title={piece.title}
      style={{ ...look.style, ...style }}
      className={cx(
        'flex shrink-0 cursor-pointer items-center justify-between gap-1.5 rounded-lg text-left text-[13px] leading-tight font-semibold hover:brightness-105 max-sm:flex-col-reverse max-sm:items-start max-sm:justify-end',
        named ? 'min-h-[68px] p-2' : 'h-8', look.className, picked && 'outline-[3px] outline-offset-1 outline-ink outline-solid', focusRing,
      )}
    >
      {named && <span className="line-clamp-4 min-w-0">{piece.title}</span>}
      {named && <Avatar person={{ id: piece.userId ?? '', name: piece.who }} size={22} />}
    </button>
  );
}

const firstPick = (work) => work.find((w) => w.fromYourRequest && w.stage === 'now') ?? work.find((w) => w.stage === 'now') ?? work.at(-1);

function Detail({ piece }) {
  const planning = piece.stage !== 'done' && !piece.what;
  return (
    <div className="mt-3 border-t border-line pt-3" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <p className="m-0 font-semibold text-ink">{piece.title}</p>
        {(piece.fromYourRequest || piece.fromRequest) && <Badge tone="violet">{piece.fromYourRequest ? 'You asked for this' : 'From an observer request'}</Badge>}
      </div>
      <p className="m-0 mt-0.5 text-sm text-dim">{piece.statusWords} · {piece.who}</p>
      <WhatWhy
        what={piece.what ?? (planning ? piece.details : null)}
        why={piece.why}
        whatLabel={piece.stage === 'done' ? 'What changed' : planning ? 'What is planned' : 'What was built'}
      />
      {piece.rules.length > 0 && (
        <p className="m-0 mt-2 text-[13px] text-dim">
          Built to follow: {piece.rules.map((rule) => `${rule.title} (version ${rule.version})`).join(', ')}
        </p>
      )}
      {piece.rules.filter((rule) => rule.changed).map((rule) => (
        <Badge key={rule.id} tone="amber" className="mt-1.5 mr-1.5">{rule.title} has changed since this was built</Badge>
      ))}
    </div>
  );
}

export default function WorkWall({ work, counts }) {
  const [ref, width] = useElementWidth();
  const [pickedId, setPickedId] = useState(null);
  const { named, perRow } = wallLayout(work.length, width);
  const size = brickSize(perRow);
  const picked = work.find((w) => w.id === pickedId) ?? firstPick(work);

  return (
    <div ref={ref}>
      <div className="flex flex-col" style={{ gap: BRICK_GAP }} role="group" aria-label="The work, one brick for each piece">
        {wallRows(work, perRow).map((row) => (
          <div key={row.key} className="flex" style={{ gap: BRICK_GAP }}>
            {row.bricks.map((piece, i) => (
              <Brick
                key={piece.id}
                piece={piece}
                named={named}
                picked={piece.id === picked?.id}
                onPick={() => setPickedId(piece.id)}
                style={{ width: size.width, marginLeft: row.offset && i === 0 ? size.shift : undefined }}
              />
            ))}
          </div>
        ))}
      </div>
      <WorkLegend counts={counts} className="mt-3" />
      {picked && <Detail piece={picked} />}
    </div>
  );
}

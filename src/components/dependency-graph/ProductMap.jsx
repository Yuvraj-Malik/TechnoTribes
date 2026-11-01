// The code graph as a blueprint: the site's pages, the parts they share, and who is
// changing each one. Pick a part to see what a change to it would touch.
import { useState } from 'react';
import { cx } from '../common/ui';
import { focusRing } from '../common/styles';
import { useElementWidth } from '../../hooks/useElementWidth';
import { busiestPart, changingWords, columnCentre, describePart } from '../../features/observer/progressModel';

const BLUEPRINT = {
  backgroundImage: 'radial-gradient(color-mix(in srgb, var(--panel-dim) 20%, transparent) 1px, transparent 1px)',
  backgroundSize: '24px 24px',
};
const LINES_FROM = 640; // below this width the parts stack, so there is nothing to join
const MOST_COLUMNS = 6;
const BAND = 72;

function Part({ part, picked, nearby, onPick }) {
  const status = part.isNew ? 'Being added' : 'Live';
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={picked}
      className={cx(
        'flex min-h-24 min-w-0 cursor-pointer flex-col items-start rounded-[10px] border-[1.5px] p-3 text-left text-[13px] leading-snug text-panel-dim hover:brightness-110', focusRing,
        picked ? 'border-mark bg-mark/14' : nearby ? 'border-panel-dim bg-panel-ink/5' : 'border-panel-dim/40 bg-panel-ink/5',
      )}
    >
      <span className="text-[15px] font-semibold text-panel-ink">{part.name}</span>
      <span className="mt-0.5 flex items-center gap-1.5"><i className="size-2 rounded-full bg-[#6fd3a1]" aria-hidden="true" />{status}</span>
      <span className="mt-0.5">{changingWords(part.people)}</span>
    </button>
  );
}

function Planned({ item }) {
  return (
    <div className="flex min-h-24 min-w-0 flex-col rounded-[10px] border-[1.5px] border-dashed border-panel-dim/70 p-3 text-[13px] leading-snug text-panel-dim">
      <span className="text-[15px] font-semibold text-panel-ink">{item.title}</span>
      <span className="mt-0.5">Not started{item.who ? ` · ${item.who} is next` : ''}</span>
    </div>
  );
}

function Links({ map, pages, shared, columns, pickedId }) {
  const x = (list, id) => columnCentre(list.findIndex((p) => p.id === id), list === pages ? columns : shared.length) * 1000;
  const lit = (l) => l.from === pickedId || l.to === pickedId;
  return (
    <svg viewBox={`0 0 1000 ${BAND}`} preserveAspectRatio="none" aria-hidden="true" className="block w-full" style={{ height: BAND }}>
      {[...map.links].sort((a, b) => lit(a) - lit(b)).map((l) => {
        const from = x(pages, l.from);
        const to = x(shared, l.to);
        return (
          <path
            key={`${l.from}-${l.to}`}
            d={`M${from} 0 C${from} ${BAND / 2} ${to} ${BAND / 2} ${to} ${BAND}`}
            fill="none"
            stroke={lit(l) ? 'var(--mark)' : 'color-mix(in srgb, var(--panel-dim) 42%, transparent)'}
            strokeWidth={lit(l) ? 2 : 1.5}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}

export default function ProductMap({ map }) {
  const [ref, width] = useElementWidth();
  const [pickedId, setPickedId] = useState(null);
  const pages = map.parts.filter((p) => p.kind === 'page');
  const shared = map.parts.filter((p) => p.kind === 'shared');
  const planned = map.planned.slice(0, Math.max(0, MOST_COLUMNS - pages.length));
  const picked = map.parts.find((p) => p.id === pickedId) ?? busiestPart(map);
  const columns = pages.length + planned.length;
  const wide = width >= LINES_FROM && columns <= MOST_COLUMNS && shared.length <= MOST_COLUMNS;
  const near = (p) => map.links.some((l) => (l.from === picked?.id && l.to === p.id) || (l.to === picked?.id && l.from === p.id));
  const row = (count) => (wide ? { gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` } : undefined);

  return (
    <div ref={ref} className="flex flex-col rounded-xl bg-panel p-4 text-panel-ink sm:p-5" style={BLUEPRINT}>
      <div className="grid gap-3" style={row(columns)}>
        {pages.map((p) => <Part key={p.id} part={p} picked={p.id === picked?.id} nearby={near(p)} onPick={() => setPickedId(p.id)} />)}
        {planned.map((item) => <Planned key={item.id} item={item} />)}
      </div>
      {wide && shared.length > 0 ? <Links map={map} pages={pages} shared={shared} columns={columns} pickedId={picked?.id} /> : <div className="h-3" />}
      <div className="grid gap-3" style={row(shared.length)}>
        {shared.map((p) => <Part key={p.id} part={p} picked={p.id === picked?.id} nearby={near(p)} onPick={() => setPickedId(p.id)} />)}
      </div>
      {picked && (
        <p aria-live="polite" className="m-0 mt-4 flex items-start gap-3 rounded-[10px] bg-mark/12 px-3.5 py-3 text-sm max-sm:order-first max-sm:mt-0 max-sm:mb-3">
          <i className="mt-1.5 ml-0.5 size-2.5 shrink-0 rotate-45 rounded-[2px] bg-mark" aria-hidden="true" />
          <span>{describePart(picked, map)}</span>
        </p>
      )}
      {map.hidden > 0 && <p className="m-0 mt-3 text-[13px] text-panel-dim">Plus {map.hidden} behind-the-scenes {map.hidden === 1 ? 'part' : 'parts'} customers do not see.</p>}
    </div>
  );
}

// The live site as a line, with each open piece of work on a side track that joins
// the line once a person approves it: the branch graph, in plain words.
import { useMemo } from 'react';
import { colorFor } from '../common/ui';
import { focusRing } from '../common/styles';
import { layoutProjectLine } from '../../features/observer/progressModel';

function Person({ x, y, userId, who }) {
  return (
    <>
      <circle cx={x} cy={y} r="15" fill={colorFor(userId ?? '')} stroke="var(--surface)" strokeWidth="3" />
      <text x={x} y={y + 5} textAnchor="middle" fontSize="14" fontWeight="600" fill="#ffffff">{(who || '?')[0]}</text>
    </>
  );
}

// A title on one or two lines, with a smaller line under it.
function StopLabel({ x, y, lines, sub, anchor = 'middle' }) {
  return (
    <text x={x} y={y} textAnchor={anchor}>
      {lines.map((line, i) => <tspan key={line} x={x} dy={i ? 18 : 0} fontSize="15" fontWeight="600" fill="var(--ink)">{line}</tspan>)}
      <tspan x={x} dy="19" fontSize="13" fill="var(--dim)">{sub}</tspan>
    </text>
  );
}

const firstName = (name) => String(name).split(/\s+/)[0];

function describe({ stops, tracks, planned }) {
  const live = stops.map((s) => `${s.title} by ${s.who}`).join('; ');
  const open = tracks.map((t) => `${t.title}: ${t.statusWords}`).join(' ');
  return [`Live: ${live || 'nothing yet'}.`, open && `Being finished: ${open}`, planned && `Not started: ${planned.title}.`].filter(Boolean).join(' ');
}

export default function ProjectLine({ line }) {
  const map = useMemo(() => layoutProjectLine(line), [line]);
  const { mainY, originX, joinX, stops, tracks, planned, overlap, earlier, hiddenTracks, showNext } = map;

  return (
    <div tabIndex={0} aria-label="Project line, scrolls sideways" className={`overflow-x-auto overscroll-x-contain ${focusRing}`}>
      <svg viewBox={`0 0 ${map.width} ${map.height}`} role="img" aria-label={describe(map)} className="block h-auto w-full min-w-[760px]">
        {tracks.length > 0 && <text x="880" y="16" textAnchor="end" fontSize="13" fill="var(--dim)">Further along →</text>}
        {showNext && <path d={`M${originX} ${mainY} H${joinX}`} fill="none" stroke="var(--dim)" strokeWidth="3" strokeLinecap="round" strokeDasharray="1 9" />}
        {tracks.map((t) => (
          <path key={`${t.id}-ahead`} d={t.ahead} fill="none" stroke={colorFor(t.userId ?? '')} strokeWidth="3" strokeLinecap="round" strokeDasharray="1 8" opacity="0.6" />
        ))}
        {tracks.map((t) => <path key={t.id} d={t.built} fill="none" stroke={colorFor(t.userId ?? '')} strokeWidth="3" strokeLinecap="round" />)}
        {stops.length > 1 && <path d={`M${stops[0].x} ${mainY} H${originX}`} fill="none" stroke="var(--ok)" strokeWidth="6" strokeLinecap="round" />}

        {overlap && (
          <>
            <path d={`M${overlap.x} ${overlap.top} V${overlap.bottom}`} fill="none" stroke="var(--mark)" strokeWidth="2" />
            <rect x={overlap.x - 7} y={overlap.mark - 7} width="14" height="14" rx="3" transform={`rotate(45 ${overlap.x} ${overlap.mark})`} fill="var(--mark)" />
            <text x={overlap.x + 18} y={overlap.mark - 4} fontSize="13" fontWeight="600" fill="var(--ink)">Both change the {overlap.part}.</text>
            <text x={overlap.x + 18} y={overlap.mark + 14} fontSize="13" fill="var(--dim)">Their AI agents warned them.</text>
          </>
        )}

        {stops.map((s) => <Person key={s.version} x={s.x} y={mainY} userId={s.userId} who={s.who} />)}
        {tracks.map((t) => <Person key={t.id} x={t.tip} y={t.y} userId={t.userId} who={t.who} />)}
        {planned && <circle cx={planned.x} cy={mainY} r="10" fill="var(--surface)" stroke="var(--dim)" strokeWidth="2" strokeDasharray="3 3" />}
        {showNext && <rect x={joinX - 10} y={mainY - 10} width="20" height="20" rx="4" transform={`rotate(45 ${joinX} ${mainY})`} fill="var(--surface)" stroke="var(--ok)" strokeWidth="3" />}

        {tracks.map((t) => (
          <text key={`${t.id}-label`} x={t.labelX} y={t.y - 36}>
            <tspan fontSize="15" fontWeight="600" fill="var(--ink)">{t.title}</tspan>
            <tspan x={t.labelX} dy="19" fontSize="14" fill="var(--dim)">{t.statusWords}</tspan>
          </text>
        ))}
        {stops.map((s) => <StopLabel key={s.version} x={s.x} y={mainY + 38} lines={s.lines} sub={`Version ${s.version} · ${firstName(s.who)}`} />)}
        {earlier > 0 && <text x={0} y={mainY - 26} fontSize="13" fill="var(--dim)">{earlier} earlier {earlier === 1 ? 'version' : 'versions'}</text>}
        {planned && <StopLabel x={planned.x} y={mainY + 38} lines={planned.lines} sub={`Not started · ${firstName(planned.who)}${planned.more ? ` · ${planned.more} more planned` : ''}`} />}
        {showNext && <StopLabel x={1124} y={mainY + 38} lines={['Next update']} sub="Live once approved" anchor="end" />}
        {hiddenTracks > 0 && <text x="530" y={mainY - 26} fontSize="13" fill="var(--dim)">{hiddenTracks} more being finished</text>}
      </svg>
    </div>
  );
}

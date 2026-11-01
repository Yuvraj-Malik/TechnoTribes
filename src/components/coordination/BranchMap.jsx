// A git-style graph: main runs down the left, and each open piece of work branches
// off the version it started from. Newest at the top, like `git log --graph`.
import { useMemo, useState } from 'react';
import { Badge, colorFor } from '../common/ui';
import { timeAgo } from '../../utils/time';
import { ROW_HEIGHT, layoutBranchMap } from '../../features/coordination/codeModel';
import { useElementWidth } from '../../hooks/useElementWidth';

const STATES = {
  building: { label: 'Building', tone: 'blue' },
  review: { label: 'In review', tone: 'slate' },
  clash: { label: 'Clash', tone: 'amber' },
  outdated: { label: 'Out of date', tone: 'red' },
};

const RECENT_VERSIONS = 8;
const COMPACT_BELOW = 560; // px of space for the whole map

// On narrow screens the lanes share at most 40% of the width, so the text stays readable.
const compactLaneWidth = (width, branchCount) => Math.max(8, Math.min(12, Math.floor((width * 0.4) / (branchCount + 1))));

const fileCount = (targets) => `${targets.length} ${targets.length === 1 ? 'file' : 'files'}`;

function BranchTip({ x, y, color, state }) {
  if (state === 'outdated') {
    return <circle cx={x} cy={y} r="6" fill="var(--surface)" stroke="var(--err)" strokeWidth="2" strokeDasharray="3 2" />;
  }
  return (
    <>
      {state === 'clash' && <circle cx={x} cy={y} r="9.500" fill="none" stroke="var(--mark)" strokeWidth="2" />}
      <circle cx={x} cy={y} r="6" fill={state === 'building' ? 'var(--surface)' : color} stroke={color} strokeWidth="2" />
      {state === 'building' && <circle cx={x} cy={y} r="2.500" fill={color} className="motion-safe:animate-pulse" />}
    </>
  );
}

function BranchRow({ row, compact }) {
  const state = STATES[row.state];
  const badge = <Badge tone={state.tone}>{state.label}</Badge>;
  const detail = [compact && row.behind > 0 ? `${row.behind} behind` : null, row.who, row.goal, fileCount(row.targets)];
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <code className="min-w-0 truncate font-mono text-[13px] font-semibold text-ink">{row.name}</code>
        {!compact && badge}
        {!compact && row.behind > 0 && <span className="text-xs whitespace-nowrap text-dim">{row.behind} behind main</span>}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {compact && badge}
        <p className="m-0 min-w-0 truncate text-[13px] text-dim" title={row.goal}>{detail.filter(Boolean).join(' · ')}</p>
      </div>
    </div>
  );
}

function CommitRow({ row, head, compact }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <code className="font-mono text-[13px] font-semibold text-ink">v{row.version}</code>
        {head && !compact && <Badge>main</Badge>}
        <span className="min-w-0 truncate text-sm text-ink" title={row.summary}>{row.summary}</span>
      </div>
      <p className="m-0 truncate text-[13px] text-dim">{[row.author, timeAgo(row.at)].filter(Boolean).join(' · ')}</p>
    </div>
  );
}

export default function BranchMap({ branches, log }) {
  const [showAll, setShowAll] = useState(false);
  const [ref, width] = useElementWidth();
  const compact = width > 0 && width < COMPACT_BELOW;
  const laneWidth = compact ? compactLaneWidth(width, branches.length) : undefined;

  // Recent versions, plus anything an open branch still has to connect to.
  const shown = useMemo(() => {
    if (showAll) return log;
    const oldestBase = Math.min(...branches.map((b) => b.baseVersion), Infinity);
    return log.filter((entry, i) => i < RECENT_VERSIONS || entry.version >= oldestBase);
  }, [log, branches, showAll]);
  const hidden = log.length - shown.length;
  const map = useMemo(() => layoutBranchMap({ branches, log: shown, laneWidth }), [branches, shown, laneWidth]);

  return (
    <div ref={ref} className="relative overflow-hidden rounded-xl border border-line bg-surface">
      <svg width={map.width} height={map.height} className="absolute top-0 left-0" aria-hidden="true">
        {map.trunk.bottom > map.trunk.top && <line x1={map.trunk.x} x2={map.trunk.x} y1={map.trunk.top} y2={map.trunk.bottom} stroke="var(--dim)" strokeWidth="2" />}
        {map.links.map((link) => (
          <path
            key={link.key}
            d={link.d}
            fill="none"
            stroke={link.state === 'outdated' ? 'var(--err)' : colorFor(link.userId)}
            strokeWidth="2"
            strokeDasharray={link.state === 'outdated' ? '4 4' : undefined}
          />
        ))}
        {map.rows.map((row) => (
          <g key={row.key}>
            {row.type === 'branch' && <BranchTip x={row.cx} y={row.cy} color={colorFor(row.userId)} state={row.state} />}
            {row.type === 'commit' && <circle cx={row.cx} cy={row.cy} r="5.500" fill={colorFor(row.authorId ?? '')} stroke="var(--surface)" strokeWidth="1.500" />}
            {row.type === 'root' && <circle cx={row.cx} cy={row.cy} r="4" fill="var(--surface)" stroke="var(--dim)" strokeWidth="2" />}
          </g>
        ))}
      </svg>
      <ol className="m-0 list-none p-0" style={{ paddingLeft: map.width }}>
        {map.rows.map((row, i) => (
          <li key={row.key} style={{ height: ROW_HEIGHT }} className={`flex items-center pr-4 ${i ? 'border-t border-line' : ''}`}>
            {row.type === 'branch' && <BranchRow row={row} compact={compact} />}
            {row.type === 'commit' && <CommitRow row={row} head={i === branches.length} compact={compact} />}
            {row.type === 'root' && <span className="text-[13px] text-dim">Project created</span>}
          </li>
        ))}
      </ol>
      {hidden > 0 && (
        <div className="border-t border-line px-4 py-2.5">
          <button type="button" className="inline-flex min-h-11 cursor-pointer items-center border-0 bg-transparent p-0 text-sm font-semibold text-accent hover:underline" onClick={() => setShowAll(true)}>
            Show {hidden} older {hidden === 1 ? 'version' : 'versions'}
          </button>
        </div>
      )}
    </div>
  );
}

// A git-style graph: main runs down the left, and each open piece of work branches
// off the version it was based on. Newest at the top, like `git log --graph`.
import { useMemo, useState } from 'react';
import Badge from '../common/Badge';
import { card, linkButton } from '../common/styles';
import { when } from '../timeline/RecentChanges';
import { ROW_HEIGHT, layoutBranchMap } from '../../features/coordination/codeModel';

const STATES = {
  building: { label: 'Building', tone: 'accent' },
  review: { label: 'In review', tone: 'neutral' },
  clash: { label: 'Clash', tone: 'warn' },
  outdated: { label: 'Out of date', tone: 'err' },
};

const RECENT_VERSIONS = 8;

const fileCount = (targets) => {
  const count = targets.filter((key) => key.startsWith('file:')).length;
  return `${count} ${count === 1 ? 'file' : 'files'}`;
};

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

// Circles are code changes, diamonds are brief changes, squares are imports.
function Commit({ row, color }) {
  const { cx: x, cy: y, kind, type } = row;
  if (type === 'root') return <circle cx={x} cy={y} r="4" fill="var(--surface)" stroke="var(--dim)" strokeWidth="2" />;
  if (kind === 'brief') return <rect x={x - 5} y={y - 5} width="10" height="10" rx="1.500" fill="var(--mark)" transform={`rotate(45 ${x} ${y})`} />;
  if (kind === 'import') return <rect x={x - 5} y={y - 5} width="10" height="10" rx="2" fill="var(--dim)" />;
  return <circle cx={x} cy={y} r="5.500" fill={color || 'var(--dim)'} stroke="var(--surface)" strokeWidth="1.500" />;
}

function BranchRow({ row }) {
  const state = STATES[row.state];
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <code className="min-w-0 truncate font-mono text-[13px] font-semibold">{row.name}</code>
        <Badge tone={state.tone}>{state.label}</Badge>
        {row.behind > 0 && <span className="hidden text-xs whitespace-nowrap text-dim sm:inline">{row.behind} behind main</span>}
      </div>
      <p className="m-0 truncate text-[13px] text-dim" title={row.reason || row.goal}>
        {row.who} · {row.reason || row.goal} · {fileCount(row.targets)}
      </p>
    </div>
  );
}

function CommitRow({ row, head }) {
  const author = row.submittedByName;
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <code className="font-mono text-[13px] font-semibold">v{row.version}</code>
        {head && <Badge>main</Badge>}
        <span className="min-w-0 truncate text-sm" title={row.summary}>{row.summary}</span>
      </div>
      <p className="m-0 truncate text-[13px] text-dim">
        {[author, row.kind === 'brief' ? 'brief change' : null, when(row.created_at)].filter(Boolean).join(' · ')}
      </p>
    </div>
  );
}

export default function BranchMap({ branches, log, colors, focus }) {
  const [showAll, setShowAll] = useState(false);

  // Recent versions, plus anything an open branch still has to connect to.
  const shown = useMemo(() => {
    if (showAll) return log;
    const oldestBase = Math.min(...branches.map((b) => b.baseVersion), Infinity);
    return log.filter((entry, i) => i < RECENT_VERSIONS || entry.version >= oldestBase);
  }, [log, branches, showAll]);
  const hidden = log.length - shown.length;

  const map = useMemo(() => layoutBranchMap({ branches, log: shown }), [branches, shown]);
  const faded = (userId) => focus && userId !== focus;
  const owner = (row) => (row.type === 'branch' ? row.userId : row.submitted_by);

  return (
    <div className={`${card} relative overflow-hidden`}>
      <svg width={map.width} height={map.height} className="absolute top-0 left-0" aria-hidden="true">
        {map.trunk.bottom > map.trunk.top && <line x1={map.trunk.x} x2={map.trunk.x} y1={map.trunk.top} y2={map.trunk.bottom} stroke="var(--dim)" strokeWidth="2" />}
        {map.links.map((link) => (
          <path
            key={link.key}
            d={link.d}
            fill="none"
            stroke={link.state === 'outdated' ? 'var(--err)' : colors[link.userId] || 'var(--dim)'}
            strokeWidth="2"
            strokeDasharray={link.state === 'outdated' ? '4 4' : undefined}
            opacity={faded(link.userId) ? 0.15 : 1}
          />
        ))}
        {map.rows.map((row) => (
          <g key={row.key} opacity={row.type !== 'root' && faded(owner(row)) ? 0.2 : 1}>
            {row.type === 'branch'
              ? <BranchTip x={row.cx} y={row.cy} color={colors[row.userId] || 'var(--dim)'} state={row.state} />
              : <Commit row={row} color={colors[row.submitted_by]} />}
          </g>
        ))}
      </svg>
      <ol className="m-0 list-none p-0" style={{ paddingLeft: map.width }}>
        {map.rows.map((row, i) => (
          <li
            key={row.key}
            style={{ height: ROW_HEIGHT, opacity: row.type !== 'root' && faded(owner(row)) ? 0.35 : 1 }}
            className={`flex items-center pr-4 ${i ? 'border-t border-line' : ''}`}
          >
            {row.type === 'branch' && <BranchRow row={row} />}
            {row.type === 'commit' && <CommitRow row={row} head={i === branches.length} />}
            {row.type === 'root' && <span className="text-[13px] text-dim">Project created</span>}
          </li>
        ))}
      </ol>
      {hidden > 0 && (
        <div className="border-t border-line px-4 py-2.5">
          <button type="button" className={linkButton} onClick={() => setShowAll(true)}>
            Show {hidden} older {hidden === 1 ? 'version' : 'versions'}
          </button>
        </div>
      )}
    </div>
  );
}

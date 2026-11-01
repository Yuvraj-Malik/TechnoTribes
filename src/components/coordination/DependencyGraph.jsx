// The code graph: which file uses which. Pick a file to light up everything it
// relies on and everything a change to it would affect.
import { useMemo, useState } from 'react';
import { colorFor } from '../common/ui';
import { focusRing } from '../common/styles';
import { EmptyState } from '../dashboard/ui';
import { NODE_HEIGHT, NODE_WIDTH, filePresence, impactOf, layoutDependencyGraph } from '../../features/coordination/codeModel';

const MAX_LABEL = 19;
const shortLabel = (label) => (label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label);

export default function DependencyGraph({ edges, branches }) {
  const graph = useMemo(() => layoutDependencyGraph({ edges }), [edges]);
  const presence = useMemo(() => filePresence(branches), [branches]);
  const [selected, setSelected] = useState(null);
  const impact = useMemo(() => (selected ? impactOf(selected, edges) : null), [selected, edges]);

  if (!graph.placed.length) {
    return <EmptyState icon="code" title="No links between files yet" text="The graph builds itself from the imports and links inside the project's files." />;
  }

  const lit = (key) => !selected || key === selected || impact.dependsOn.has(key) || impact.affects.has(key);
  // A link lights up when both ends are on the same path through the selected node.
  const onPath = (link, set) => (link.from === selected || set.has(link.from)) && (link.to === selected || set.has(link.to));
  const linkLit = (link) => !selected || onPath(link, impact.affects) || onPath(link, impact.dependsOn);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div tabIndex={0} aria-label="Dependency graph, scrolls sideways" className={`overflow-x-auto overscroll-x-contain p-4 ${focusRing}`}>
        <svg width={graph.width} height={graph.height} role="group" aria-label="Dependency graph" className="block">
          {graph.links.map((link) => (
            <path
              key={`${link.from}-${link.to}`}
              d={link.d}
              fill="none"
              stroke={selected && linkLit(link) ? 'var(--accent)' : 'var(--dim)'}
              strokeWidth={selected && linkLit(link) ? 2 : 1.25}
              opacity={linkLit(link) ? 0.8 : 0.15}
            />
          ))}
          {graph.placed.map((node) => {
            const working = presence[node.key]?.[0];
            let stroke = 'var(--line)';
            if (working) stroke = colorFor(working.userId);
            if (node.key === selected) stroke = 'var(--accent)';
            return (
              <g
                key={node.key}
                role="button"
                tabIndex={0}
                aria-pressed={node.key === selected}
                aria-label={`${node.key}${working ? `, ${working.who} is working here` : ''}`}
                transform={`translate(${node.x} ${node.y})`}
                opacity={lit(node.key) ? 1 : 0.3}
                onClick={() => setSelected(node.key === selected ? null : node.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelected(node.key === selected ? null : node.key);
                  }
                }}
                className={`cursor-pointer ${focusRing}`}
              >
                <title>{node.key}</title>
                <rect width={NODE_WIDTH} height={NODE_HEIGHT} rx="8" fill="var(--surface)" stroke={stroke} strokeWidth={working || node.key === selected ? 2 : 1} />
                <text x="12" y={NODE_HEIGHT / 2 + 4.5} fontSize="12.500" fontFamily="monospace" fill="var(--ink)">{shortLabel(node.label)}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <p aria-live="polite" className="m-0 border-t border-line px-4 py-2.5 text-[13px] text-dim">
        {selected
          ? `${selected}: a change here affects ${impact.affects.size} and it relies on ${impact.dependsOn.size}.`
          : 'Pick a file to trace it. Coloured outlines show who is working there.'}
      </p>
    </div>
  );
}

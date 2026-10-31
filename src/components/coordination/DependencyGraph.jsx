// The code graph: what depends on what, with requirements on the left. Pick a node
// to light up everything it relies on and everything a change to it would affect.
import { useMemo, useState } from 'react';
import { card, focusRing } from '../common/styles';
import { NODE_HEIGHT, NODE_WIDTH, filePresence, impactOf, layoutDependencyGraph } from '../../features/coordination/codeModel';

const MAX_LABEL = 19;
const shortLabel = (label) => (label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label);
const plainKey = (key) => key.replace(/^file:/, '');

export default function DependencyGraph({ nodes, edges, branches, colors, focus }) {
  const graph = useMemo(() => layoutDependencyGraph({ nodes, edges }), [nodes, edges]);
  const presence = useMemo(() => filePresence(branches), [branches]);
  const [selected, setSelected] = useState(null);
  const impact = useMemo(() => (selected ? impactOf(selected, edges) : null), [selected, edges]);

  if (!graph.placed.length) {
    return <p className={`${card} m-0 px-6 py-10 text-center text-sm text-dim`}>The graph builds itself as changes are approved, from what each Builder says it depends on.</p>;
  }

  const here = (key) => presence[key.replace(/^file:/, '')] || [];
  const touched = (key) => here(key).some((b) => b.userId === focus);
  const lit = (key) => {
    if (selected) return key === selected || impact.dependsOn.has(key) || impact.affects.has(key);
    return focus ? touched(key) : true;
  };
  // A link lights up when both ends are on the same path through the selected node.
  const onPath = (link, set) => (link.from === selected || set.has(link.from)) && (link.to === selected || set.has(link.to));
  const linkLit = (link) => (selected ? onPath(link, impact.affects) || onPath(link, impact.dependsOn) : !focus);

  return (
    <div className={`${card} overflow-hidden`}>
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
            const working = here(node.key)[0];
            const isRequirement = node.kind === 'req';
            let stroke = isRequirement ? 'var(--mark)' : 'var(--line)';
            if (working) stroke = colors[working.userId] || 'var(--dim)';
            if (node.key === selected) stroke = 'var(--accent)';
            return (
              <g
                key={node.key}
                role="button"
                tabIndex={0}
                aria-pressed={node.key === selected}
                aria-label={`${plainKey(node.key)}${working ? `, ${working.who} is working here` : ''}`}
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
                <title>{plainKey(node.key)}</title>
                <rect width={NODE_WIDTH} height={NODE_HEIGHT} rx="8" fill="var(--surface)" stroke={stroke} strokeWidth={working || node.key === selected || isRequirement ? 2 : 1} />
                <text x="12" y={NODE_HEIGHT / 2 + 4.5} fontSize="12.500" fontFamily="var(--font-mono, monospace)" fill="var(--ink)">{shortLabel(node.label)}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <p aria-live="polite" className="m-0 border-t border-line px-4 py-2.5 text-[13px] text-dim">
        {selected
          ? `${plainKey(selected)}: a change here affects ${impact.affects.size} and it relies on ${impact.dependsOn.size}.`
          : 'Pick a node to trace it. Yellow outlines are requirements from the brief; coloured outlines show who is working there.'}
      </p>
    </div>
  );
}

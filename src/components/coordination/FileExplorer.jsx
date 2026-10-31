// The project's code: a file tree showing who is in each file, and the selected
// file with its history and connections. Files come from the approved state.
import { useMemo, useState } from 'react';
import Badge from '../common/Badge';
import Icon from '../common/Icon';
import { card, focusRing } from '../common/styles';
import { buildFileTree, fileFacts, filePresence } from '../../features/coordination/codeModel';

const CODE_PATH = 'break-all font-mono';

function Presence({ branches, colors }) {
  const seen = [...new Map(branches.map((b) => [b.userId, b])).values()];
  return (
    <span className="ml-auto flex flex-none items-center gap-1 pl-2">
      {seen.map((b) => <span key={b.userId} title={`${b.who}: ${b.goal}`} className="size-2 rounded-full" style={{ backgroundColor: colors[b.userId] || 'var(--dim)' }} />)}
    </span>
  );
}

function ConnectionList({ title, keys }) {
  if (!keys.length) return null;
  return (
    <div className="min-w-0">
      <span className="text-dim">{title}: </span>
      <span className={`${CODE_PATH} text-xs`}>{keys.map((key) => key.replace(/^file:/, '')).join(', ')}</span>
    </div>
  );
}

function FileDetail({ path, content, branches, facts, colors }) {
  const lines = content === undefined ? null : content.split('\n');
  const people = new Set(branches.map((b) => b.userId));
  return (
    <div className="min-w-0 border-t border-line md:border-t-0 md:border-l">
      <div className="space-y-1 border-b border-line px-4 py-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <code className={`${CODE_PATH} text-sm font-semibold`}>{path}</code>
          {people.size > 1 && <Badge tone="warn">{people.size} people here</Badge>}
        </div>
        <div className="text-dim">
          {facts.lastChange
            ? `Last changed in v${facts.lastChange.version}${facts.lastChange.submittedByName ? ` by ${facts.lastChange.submittedByName}` : ''}`
            : 'No approved version yet'}
        </div>
        <ConnectionList title="Depends on" keys={facts.dependsOn} />
        <ConnectionList title="Used by" keys={facts.usedBy} />
        {branches.map((b) => (
          <div key={b.id} className="flex items-baseline gap-2">
            <span aria-hidden="true" className="size-2 flex-none rounded-full" style={{ backgroundColor: colors[b.userId] || 'var(--dim)' }} />
            <span className="min-w-0">{b.who}: {b.goal}</span>
          </div>
        ))}
      </div>
      {lines ? (
        <pre tabIndex={0} aria-label={`Contents of ${path}`} className={`m-0 max-h-[460px] overflow-auto bg-bg py-3 font-mono text-[13px] leading-5 ${focusRing}`}>
          {lines.map((line, i) => (
            <div key={i} className="flex">
              <span aria-hidden="true" className="sticky left-0 w-11 flex-none bg-bg pr-3 text-right text-dim/60 select-none">{i + 1}</span>
              <span className="pr-4 whitespace-pre">{line || ' '}</span>
            </div>
          ))}
        </pre>
      ) : (
        <p className="m-0 px-4 py-6 text-sm text-dim">This file is new. Its code shows up here once the change is approved.</p>
      )}
    </div>
  );
}

export default function FileExplorer({ files, branches, log, edges, colors, focus }) {
  const presence = useMemo(() => filePresence(branches), [branches]);
  const rows = useMemo(() => buildFileTree([...new Set([...Object.keys(files), ...Object.keys(presence)])]), [files, presence]);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [picked, setPicked] = useState(null);

  if (!rows.length) {
    return <p className={`${card} m-0 px-6 py-10 text-center text-sm text-dim`}>No code yet. Files show up here after the first approved change or a GitHub import.</p>;
  }

  const firstFile = rows.find((row) => !row.isDir && presence[row.path]) || rows.find((row) => !row.isDir);
  const selected = picked && rows.some((row) => row.path === picked) ? picked : firstFile?.path;
  const visible = rows.filter((row) => ![...collapsed].some((dir) => row.path.startsWith(`${dir}/`)));

  function toggle(path) {
    const next = new Set(collapsed);
    if (!next.delete(path)) next.add(path);
    setCollapsed(next);
  }

  return (
    <div className={`${card} grid overflow-hidden md:grid-cols-[minmax(220px,300px)_minmax(0,1fr)]`}>
      <ul aria-label="Project files" className="m-0 max-h-80 list-none overflow-y-auto p-1.5 md:max-h-[640px]">
        {visible.map((row) => {
          const here = presence[row.path] || [];
          const dim = focus && !row.isDir && !here.some((b) => b.userId === focus);
          const active = !row.isDir && row.path === selected;
          return (
            <li key={row.path}>
              <button
                type="button"
                aria-expanded={row.isDir ? !collapsed.has(row.path) : undefined}
                aria-current={active ? 'true' : undefined}
                onClick={() => (row.isDir ? toggle(row.path) : setPicked(row.path))}
                style={{ paddingLeft: 8 + row.depth * 14 }}
                className={`flex w-full cursor-pointer items-center gap-1.5 rounded-md border-0 py-1 pr-2 text-left font-mono text-[13px] max-lg:min-h-11 ${focusRing} ${active ? 'bg-ink/[0.07] font-semibold text-ink' : 'bg-transparent text-ink hover:bg-ink/[0.04]'} ${dim ? 'opacity-40' : ''}`}
              >
                {row.isDir && <Icon name="chevron" className={`size-3.5 text-dim transition-transform motion-reduce:transition-none ${collapsed.has(row.path) ? '' : 'rotate-90'}`} />}
                <Icon name={row.isDir ? 'folder' : 'file'} className="size-4 text-dim" />
                <span className="min-w-0 truncate">{row.name}</span>
                {here.length > 0 && <Presence branches={here} colors={colors} />}
              </button>
            </li>
          );
        })}
      </ul>
      {selected && (
        <FileDetail
          key={selected}
          path={selected}
          content={files[selected]}
          branches={presence[selected] || []}
          facts={fileFacts(selected, { log, edges })}
          colors={colors}
        />
      )}
    </div>
  );
}

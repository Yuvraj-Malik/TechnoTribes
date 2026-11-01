// The approved project: a file tree showing who is in each file, and the selected
// file with its history and connections.
import { useEffect, useMemo, useState } from 'react';
import { useTeam } from '../../context/TeamContext';
import { Badge, colorFor, cx } from '../common/ui';
import Icon from '../common/Icon';
import { focusRing } from '../common/styles';
import { EmptyState } from '../dashboard/ui';
import { buildFileTree, fileFacts, filePresence } from '../../features/coordination/codeModel';

const CODE_PATH = 'break-all font-mono';

function Presence({ branches }) {
  const seen = [...new Map(branches.map((b) => [b.userId, b])).values()];
  return (
    <span className="ml-auto flex flex-none items-center gap-1 pl-2">
      {seen.map((b) => <span key={b.userId} title={`${b.who}: ${b.goal}`} className="size-2 rounded-full" style={{ backgroundColor: colorFor(b.userId) }} />)}
    </span>
  );
}

function ConnectionList({ title, paths }) {
  if (!paths.length) return null;
  return (
    <div className="min-w-0">
      <span className="text-dim">{title}: </span>
      <span className={`${CODE_PATH} text-xs text-ink`}>{paths.join(', ')}</span>
    </div>
  );
}

function FileDetail({ path, branches, facts }) {
  const { get } = useTeam();
  const [content, setContent] = useState(null);
  useEffect(() => {
    let live = true;
    get('workspace/file', { path, workspace: 'main' }).then((r) => { if (live) setContent(r.content); }).catch(() => { if (live) setContent(undefined); });
    return () => { live = false; };
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  const people = new Set(branches.map((b) => b.userId));
  return (
    <div className="min-w-0 border-t border-line md:border-t-0 md:border-l">
      <div className="space-y-1 border-b border-line px-4 py-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <code className={`${CODE_PATH} text-sm font-semibold text-ink`}>{path}</code>
          {people.size > 1 && <Badge tone="amber">{people.size} people here</Badge>}
        </div>
        <div className="text-dim">
          {facts.lastChange ? `Last changed in v${facts.lastChange.version}` : 'Part of the first version'}
        </div>
        <ConnectionList title="Depends on" paths={facts.dependsOn} />
        <ConnectionList title="Used by" paths={facts.usedBy} />
        {branches.map((b) => (
          <div key={b.id} className="flex items-baseline gap-2 text-ink">
            <span aria-hidden="true" className="size-2 flex-none rounded-full" style={{ backgroundColor: colorFor(b.userId) }} />
            <span className="min-w-0">{b.who}: {b.goal}</span>
          </div>
        ))}
      </div>
      {typeof content === 'string' ? (
        <pre tabIndex={0} aria-label={`Contents of ${path}`} className={`m-0 max-h-[460px] overflow-auto bg-bg py-3 font-mono text-[13px] leading-5 text-ink ${focusRing}`}>
          {content.split('\n').map((line, i) => (
            <div key={i} className="flex">
              <span aria-hidden="true" className="sticky left-0 w-11 flex-none bg-bg pr-3 text-right text-dim/60 select-none">{i + 1}</span>
              <span className="pr-4 whitespace-pre">{line || ' '}</span>
            </div>
          ))}
        </pre>
      ) : (
        <p className="m-0 px-4 py-6 text-sm text-dim">{content === null ? 'Loading…' : 'This file is new. Its code shows up here once the change is approved.'}</p>
      )}
    </div>
  );
}

export default function FileExplorer({ files, branches, log, edges }) {
  const presence = useMemo(() => filePresence(branches), [branches]);
  const rows = useMemo(() => buildFileTree([...new Set([...files, ...Object.keys(presence)])]), [files, presence]);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [picked, setPicked] = useState(null);

  if (!rows.length) {
    return <EmptyState icon="file" title="No code yet" text="Files show up here after the first approved change or a GitHub import." />;
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
    <div className="grid overflow-hidden rounded-xl border border-line bg-surface md:grid-cols-[minmax(220px,300px)_minmax(0,1fr)]">
      <ul aria-label="Project files" className="m-0 max-h-80 list-none overflow-y-auto p-1.5 md:max-h-[640px]">
        {visible.map((row) => {
          const here = presence[row.path] || [];
          const active = !row.isDir && row.path === selected;
          return (
            <li key={row.path}>
              <button
                type="button"
                aria-expanded={row.isDir ? !collapsed.has(row.path) : undefined}
                aria-current={active ? 'true' : undefined}
                onClick={() => (row.isDir ? toggle(row.path) : setPicked(row.path))}
                style={{ paddingLeft: 8 + row.depth * 14 }}
                className={cx('flex min-h-9 w-full cursor-pointer items-center gap-1.5 rounded-md border-0 pr-2 text-left font-mono text-[13px] text-ink max-lg:min-h-11', focusRing, active ? 'bg-accent/10 font-semibold' : 'bg-transparent hover:bg-bg')}
              >
                {row.isDir && <Icon name="chevronDown" size={14} className={cx('text-dim transition-transform motion-reduce:transition-none', collapsed.has(row.path) && '-rotate-90')} />}
                <Icon name={row.isDir ? 'folder' : 'file'} size={15} className="text-dim" />
                <span className="min-w-0 truncate">{row.name}</span>
                {here.length > 0 && <Presence branches={here} />}
              </button>
            </li>
          );
        })}
      </ul>
      {selected && <FileDetail key={selected} path={selected} branches={presence[selected] || []} facts={fileFacts(selected, { log, edges })} />}
    </div>
  );
}

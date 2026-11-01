// Unified diff viewer: one collapsible block per file, added lines green, removed red.
import { useMemo, useState } from 'react';
import { cx } from '../common/ui';
import { parseDiff } from '../../utils/diff';

function FileBlock({ f, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <button type="button" className="flex w-full cursor-pointer items-center gap-2 border-0 border-b border-line bg-bg px-3 py-2 text-left" onClick={() => setOpen((o) => !o)}>
        <span className={cx('text-dim transition', open && 'rotate-90')}>›</span>
        <span className="font-mono text-xs font-medium text-ink">{f.path}</span>
        <span className={cx('rounded px-1.5 text-[10px] font-semibold uppercase',
          f.status === 'added' ? 'bg-ok/15 text-ok' : f.status === 'deleted' ? 'bg-err/15 text-err' : 'bg-line text-dim')}
        >
          {f.status}
        </span>
        <span className="ml-auto font-mono text-xs"><span className="text-ok">+{f.added}</span> <span className="text-err">−{f.removed}</span></span>
      </button>
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[12px] leading-5">
            <tbody>
              {f.lines.map((l, i) => (l.kind === 'hunk' ? (
                <tr key={i} className="bg-accent/5 text-accent"><td colSpan={3} className="px-3 py-0.5">{l.text}</td></tr>
              ) : (
                <tr key={i} className={l.kind === 'add' ? 'bg-ok/10' : l.kind === 'del' ? 'bg-err/10' : ''}>
                  <td className="w-10 select-none border-r border-line px-2 text-right text-dim">{l.oldNo ?? ''}</td>
                  <td className="w-10 select-none border-r border-line px-2 text-right text-dim">{l.newNo ?? ''}</td>
                  <td className="whitespace-pre-wrap break-all px-3 text-ink">
                    <span className="select-none pr-2 text-dim">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>{l.text}
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function DiffViewer({ diff, empty = 'No changes yet.' }) {
  const files = useMemo(() => parseDiff(diff), [diff]);
  if (!files.length) return <div className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-dim">{empty}</div>;
  return (
    <div className="space-y-3">
      {files.map((f) => <FileBlock key={f.path} f={f} defaultOpen={files.length <= 3} />)}
    </div>
  );
}

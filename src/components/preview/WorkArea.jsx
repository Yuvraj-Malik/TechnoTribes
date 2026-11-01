// Centre column: file tree of the developer's own copy, the agent's diff, a
// plain-language summary, a file viewer and a live preview of the site.
import { useEffect, useMemo, useState } from 'react';
import { useTeam } from '../../context/TeamContext';
import DiffViewer from '../reviews/DiffViewer';
import { Badge, Card, Empty, cx } from '../common/ui';

const BUSY = ['reading_context', 'checking_conflicts', 'planning', 'working'];
const SHOW_SUMMARY = ['done', 'needs_context_decision', 'submitted', 'approved', 'sent_back', 'rejected'];

// The sandboxed preview has no storage of its own (opaque origin): give the page an in-memory one.
const STORAGE_SHIM = `<script>(function(){var m={};var s={getItem:function(k){return k in m?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}}};try{Object.defineProperty(window,'localStorage',{value:s})}catch(e){}})();</script>`;

/** Inlines a page's local CSS and JS so it runs from srcdoc. */
export function buildPreview(files, page) {
  const html = files[`web/${page}`];
  if (!html) return '<p style="font-family:sans-serif">Page not found.</p>';
  const dir = page.includes('/') ? page.slice(0, page.lastIndexOf('/') + 1) : '';
  const resolve = (href) => `web/${dir}${href}`.replace(/\/\.\//g, '/');
  return STORAGE_SHIM + html
    .replace(/<link[^>]+href="([^"]+\.css)"[^>]*>/g, (m, href) => (files[resolve(href)] !== undefined ? `<style>${files[resolve(href)]}</style>` : m))
    .replace(/<script src="([^"]+\.js)"><\/script>/g, (m, src) => (files[resolve(src)] !== undefined ? `<script>${files[resolve(src)]}</script>` : m));
}

function FileTree({ files, changed, selected, onSelect }) {
  const groups = useMemo(() => {
    const g = new Map();
    for (const f of files) {
      const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.';
      g.set(dir, [...(g.get(dir) ?? []), f]);
    }
    return [...g.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [files]);
  return (
    <div className="space-y-2 text-xs">
      {groups.map(([dir, items]) => (
        <div key={dir}>
          <div className="px-1 font-medium text-dim">{dir}/</div>
          {items.map((f) => (
            <button
              type="button"
              key={f}
              onClick={() => onSelect(f)}
              className={cx('flex w-full cursor-pointer items-center gap-1 truncate rounded border-0 px-2 py-0.5 text-left font-mono',
                selected === f ? 'bg-accent/15 text-accent' : 'bg-transparent text-ink hover:bg-bg')}
            >
              <span className="truncate">{f.slice(f.lastIndexOf('/') + 1)}</span>
              {changed.has(f) && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-mark" title="Changed by your agent" />}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function WorkArea({ task }) {
  const { get, tick } = useTeam();
  const [files, setFiles] = useState([]);
  const [diff, setDiff] = useState({ diff: '', files: [], behindMain: false });
  const [tab, setTab] = useState('changes');
  const [selected, setSelected] = useState(null);
  const [content, setContent] = useState(null);
  const [page, setPage] = useState('');
  const [bundle, setBundle] = useState(null);
  const version = `${task?.updatedAt ?? ''}`;

  useEffect(() => {
    get('workspace/files').then((r) => setFiles(r.files)).catch(() => {});
    get('workspace/diff').then(setDiff).catch(() => {});
  }, [version, tick]);

  useEffect(() => {
    if (!selected) return;
    get('workspace/file', { path: selected }).then((r) => setContent(r.content)).catch(() => setContent(null));
  }, [selected, version]);

  // The preview only reloads when the work actually changes, not on every poll.
  useEffect(() => {
    if (tab === 'preview') get('workspace/bundle').then((r) => setBundle(r.files)).catch(() => {});
  }, [tab, version]);

  const changed = useMemo(() => new Set(diff.files), [diff.files]);
  const pages = files.filter((f) => f.startsWith('web/') && f.endsWith('.html')).map((f) => f.slice(4));
  const busy = task && BUSY.includes(task.status);
  const tabs = [['changes', `Changes${diff.files.length ? ` (${diff.files.length})` : ''}`], ['file', selected ? selected.split('/').pop() : 'File'], ['preview', 'Live preview']];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 md:flex-row">
      <div className="max-h-40 w-full shrink-0 overflow-y-auto rounded-xl border border-line bg-surface p-2 md:max-h-none md:w-36">
        <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-dim">Files</div>
        <FileTree files={files} changed={changed} selected={selected} onSelect={(p) => { setSelected(p); setTab('file'); }} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {task?.summary && SHOW_SUMMARY.includes(task.status) && (
          <Card tone="blue" className="!py-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent">What changed, in plain words</div>
            <p className="m-0 text-sm text-ink">{task.summary}</p>
          </Card>
        )}
        {diff.behindMain && (
          <div className="rounded-lg bg-bg px-3 py-2 text-xs text-dim">
            The main project has moved on since your copy was made. Your diff is shown against the point where you started.
          </div>
        )}

        <div className="flex items-center gap-1 overflow-x-auto border-b border-line">
          {tabs.map(([k, label]) => (
            <button
              type="button"
              key={k}
              onClick={() => setTab(k)}
              className={cx('-mb-px cursor-pointer border-0 border-b-2 bg-transparent px-3 py-2 text-sm font-medium',
                tab === k ? 'border-accent text-accent' : 'border-transparent text-dim hover:text-ink')}
            >
              {label}
            </button>
          ))}
          {busy && <span className="ml-auto animate-pulse text-xs text-accent">Agent is working in your copy…</span>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'changes' && <DiffViewer diff={diff.diff} empty="No changes in your workspace yet. Give your agent a task on the right." />}
          {tab === 'file' && (selected ? (
            <div className="overflow-hidden rounded-lg border border-line bg-surface">
              <div className="flex items-center gap-2 border-b border-line bg-bg px-3 py-2">
                <span className="font-mono text-xs">{selected}</span>
                {changed.has(selected) && <Badge tone="amber">changed</Badge>}
              </div>
              <pre className="m-0 overflow-auto p-4 font-mono text-[13px] leading-6 whitespace-pre-wrap break-words text-ink">{content ?? '(file not found)'}</pre>
            </div>
          ) : <Empty>Pick a file from the tree.</Empty>)}
          {tab === 'preview' && (
            <div className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-lg border border-line bg-surface">
              <div className="flex items-center gap-2 border-b border-line bg-bg px-3 py-1.5 text-xs">
                <span className="text-dim">Your workspace build ·</span>
                <select className="rounded border border-line bg-surface px-1 py-0.5 text-ink" value={page || pages.find((p) => p === 'index.html') || pages[0] || ''} onChange={(e) => setPage(e.target.value)}>
                  {pages.map((p) => <option key={p}>{p}</option>)}
                </select>
                <span className="ml-auto text-dim">Switch pages with the picker</span>
              </div>
              <iframe
                title="Live preview"
                sandbox="allow-scripts allow-forms"
                srcDoc={bundle ? buildPreview(bundle, page || pages.find((p) => p === 'index.html') || pages[0] || '') : ''}
                className="min-h-0 w-full flex-1 border-0 bg-white"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

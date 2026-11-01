// Centre column of the developer workspace: an editable copy of the project.
//   Files   tree of your own copy (changed files marked), new / rename / delete
//   Code    a real code editor (Monaco, as in VS Code); Ctrl+S saves
//   Preview the site running live from your files, updating as you type
//   Changes the diff of your copy (your edits and your agent's)
// "Open folder" loads a folder from your computer (Chrome/Edge) and saves write back to it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { useTeam } from '../../context/TeamContext';
import DiffViewer from '../reviews/DiffViewer';
import { Badge, Button, Card, cx } from '../common/ui';

const BUSY = ['reading_context', 'checking_conflicts', 'planning', 'working', 'reviewing'];
const SHOW_SUMMARY = ['done', 'needs_context_decision', 'submitted', 'approved', 'sent_back', 'rejected'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.vercel', '.cache', 'coverage', '.idea', '.vscode']);
const TEXT_EXT = /\.(html?|css|scss|js|jsx|mjs|cjs|ts|tsx|json|md|txt|svg|xml|yml|yaml|toml|env\.example|sql|py|java|c|cpp|h|go|rs|rb|php|sh|vue|svelte|gitignore)$/i;
const MAX_FILE = 300000;

const LANG = { js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript', css: 'css', scss: 'scss', html: 'html', htm: 'html', json: 'json', md: 'markdown', sql: 'sql', py: 'python', java: 'java', go: 'go', rs: 'rust', php: 'php', sh: 'shell', yml: 'yaml', yaml: 'yaml', xml: 'xml', svg: 'xml' };
const langOf = (p) => LANG[p.split('.').pop().toLowerCase()] ?? 'plaintext';

// The sandboxed preview has no storage of its own (opaque origin): give the page an in-memory one.
const STORAGE_SHIM = `<script>(function(){var m={};var s={getItem:function(k){return k in m?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}}};try{Object.defineProperty(window,'localStorage',{value:s})}catch(e){}})();</script>`;

function resolveFrom(page, href) {
  if (/^(https?:)?\/\//.test(href) || href.startsWith('data:')) return null;
  const dir = page.includes('/') ? page.slice(0, page.lastIndexOf('/') + 1) : '';
  const parts = (href.startsWith('/') ? href.slice(1) : dir + href).split('?')[0].split('#')[0].split('/');
  const out = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
  return out.join('/');
}

/** Builds one HTML page with its local CSS and JS inlined, so it runs from srcdoc. */
export function buildPage(files, page) {
  const html = files[page];
  if (html == null) return '<p style="font-family:sans-serif;padding:16px">Page not found.</p>';
  const inline = (href) => { const p = resolveFrom(page, href); return p != null && files[p] != null ? files[p] : null; };
  return STORAGE_SHIM + html
    .replace(/<link\b[^>]*href=["']([^"']+\.css)["'][^>]*>/gi, (m, href) => { const c = inline(href); return c == null ? m : `<style>${c}</style>`; })
    .replace(/<script\b([^>]*)src=["']([^"']+\.m?js)["']([^>]*)><\/script>/gi, (m, a, src, b) => {
      const c = inline(src);
      return c == null ? m : `<script${/type=["']module["']/.test(a + b) ? ' type="module"' : ''}>${c.replace(/<\/script>/gi, '<\\/script>')}</script>`;
    });
}

/** Old signature, kept for the observer's Live site (pages are under web/). */
export const buildPreview = (files, page) => buildPage(files, `web/${page}`);

function FileTree({ files, changed, dirty, selected, onSelect, onRename, onDelete }) {
  const groups = useMemo(() => {
    const g = new Map();
    for (const f of files) {
      const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
      g.set(dir, [...(g.get(dir) ?? []), f]);
    }
    return [...g.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [files]);
  return (
    <div className="space-y-2 text-xs">
      {groups.map(([dir, items]) => (
        <div key={dir}>
          {dir && <div className="truncate px-1 font-medium text-dim" title={dir}>{dir}/</div>}
          {items.map((f) => (
            <div key={f} className={cx('group flex items-center rounded', selected === f ? 'bg-accent/15' : 'hover:bg-bg')}>
              <button
                type="button" onClick={() => onSelect(f)} title={f}
                className={cx('flex min-w-0 flex-1 cursor-pointer items-center gap-1 truncate border-0 bg-transparent px-2 py-1 text-left font-mono', selected === f ? 'text-accent' : 'text-ink')}
              >
                <span className="truncate">{f.slice(f.lastIndexOf('/') + 1)}</span>
                {dirty.has(f) && <span className="shrink-0 text-mark" title="Unsaved">●</span>}
                {!dirty.has(f) && changed.has(f) && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-mark" title="Changed in your copy" />}
              </button>
              <span className="hidden shrink-0 gap-0.5 pr-1 group-hover:flex">
                <button type="button" className="cursor-pointer border-0 bg-transparent px-1 text-dim hover:text-ink" title="Rename" onClick={() => onRename(f)}>✎</button>
                <button type="button" className="cursor-pointer border-0 bg-transparent px-1 text-dim hover:text-err" title="Delete" onClick={() => onDelete(f)}>✕</button>
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

async function readFolder(dir, prefix = '', out = {}, skipped = { count: 0 }) {
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'directory') {
      if (!SKIP_DIRS.has(name) && !name.startsWith('.')) await readFolder(handle, `${prefix}${name}/`, out, skipped);
    } else if (TEXT_EXT.test(name)) {
      const file = await handle.getFile();
      if (file.size <= MAX_FILE) out[`${prefix}${name}`] = await file.text(); else skipped.count += 1;
    } else skipped.count += 1;
  }
  return out;
}

async function writeToFolder(dir, path, content) {
  const parts = path.split('/');
  let d = dir;
  for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
  if (content == null) { await d.removeEntry(parts.at(-1)).catch(() => {}); return; }
  const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable();
  await w.write(content);
  await w.close();
}

export default function WorkArea({ task, onChanged }) {
  const { get, post, tick } = useTeam();
  const [files, setFiles] = useState({});          // saved content, path -> text
  const [buffers, setBuffers] = useState({});      // unsaved edits, path -> text
  const [diff, setDiff] = useState({ diff: '', files: [], behindMain: false });
  const [tab, setTab] = useState('code');
  const [split, setSplit] = useState(() => window.innerWidth >= 1280);
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [folder, setFolder] = useState(null);      // FileSystemDirectoryHandle
  const [previewSrc, setPreviewSrc] = useState('');
  const version = `${task?.updatedAt ?? ''}`;
  const busy = task && BUSY.includes(task.status);

  const loadFiles = useCallback(() => Promise.all([
    get('workspace/bundle').then((r) => setFiles(r.files)),
    get('workspace/diff').then(setDiff),
  ]).catch(() => {}), [get]);
  // Reload when the agent changes things (task version) and on the shared poll, but never over unsaved edits.
  useEffect(() => { loadFiles(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!Object.keys(buffers).length) loadFiles(); }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const paths = useMemo(() => Object.keys(files).sort(), [files]);
  useEffect(() => { if (!selected && paths.length) setSelected(paths.find((p) => /index\.html$/.test(p)) ?? paths[0]); }, [paths, selected]);
  const current = { ...files, ...buffers };
  const pages = paths.filter((p) => /\.html?$/i.test(p));
  const activePage = page && pages.includes(page) ? page : pages.find((p) => /(^|\/)index\.html$/.test(p)) ?? pages[0] ?? '';
  const changed = useMemo(() => new Set(diff.files), [diff.files]);
  const dirty = useMemo(() => new Set(Object.keys(buffers)), [buffers]);

  // Live preview follows your typing (debounced), not only your saves.
  const previewKey = JSON.stringify([activePage, Object.keys(current).length, ...Object.values(buffers).map((b) => b.length)]);
  useEffect(() => {
    const id = setTimeout(() => setPreviewSrc(activePage ? buildPage(current, activePage) : ''), 400);
    return () => clearTimeout(id);
  }, [previewKey, files, buffers, activePage]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (label, fn) => {
    setError(''); setStatus(label);
    try { await fn(); setStatus('Saved'); setTimeout(() => setStatus(''), 1500); } catch (e) { setError(e.message); setStatus(''); }
  };

  const saveFile = (path) => run('Saving…', async () => {
    const content = buffers[path];
    if (content === undefined) return;
    await post('workspace/save', { path, content });
    if (folder) await writeToFolder(folder, path, content).catch((e) => setError(`Saved in Buildify, but not to your folder: ${e.message}`));
    setFiles((f) => ({ ...f, [path]: content }));
    setBuffers((b) => { const n = { ...b }; delete n[path]; return n; });
    await get('workspace/diff').then(setDiff);
    onChanged?.();
  });
  const saveAll = () => Promise.all(Object.keys(buffers).map(saveFile));

  const saveRef = useRef(saveFile);
  saveRef.current = saveFile;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const newFile = () => {
    const name = window.prompt('New file path (for example web/about.html)');
    if (!name) return;
    const path = name.trim().replace(/^\/+/, '');
    if (files[path] != null) { setSelected(path); return; }
    run('Creating…', async () => {
      await post('workspace/save', { path, content: '' });
      if (folder) await writeToFolder(folder, path, '');
      setFiles((f) => ({ ...f, [path]: '' })); setSelected(path); setTab('code'); onChanged?.();
    });
  };
  const renameFile = (path) => {
    const to = window.prompt('Rename to', path);
    if (!to || to === path) return;
    run('Renaming…', async () => {
      await post('workspace/save', { path, rename: to.trim() });
      if (folder) { await writeToFolder(folder, to.trim(), current[path]); await writeToFolder(folder, path, null); }
      await loadFiles(); setSelected(to.trim()); onChanged?.();
    });
  };
  const deleteFile = (path) => {
    if (!window.confirm(`Delete ${path} from your copy?`)) return;
    run('Deleting…', async () => {
      await post('workspace/save', { path, content: null });
      if (folder) await writeToFolder(folder, path, null);
      setBuffers((b) => { const n = { ...b }; delete n[path]; return n; });
      if (selected === path) setSelected(null);
      await loadFiles(); onChanged?.();
    });
  };

  const openFolder = async () => {
    if (!window.showDirectoryPicker) { setError('Opening a folder needs Chrome or Edge (on Brave, turn on the File System Access API in brave://flags).'); return; }
    let dir;
    try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch { return; }
    run('Reading folder…', async () => {
      const skipped = { count: 0 };
      const loaded = await readFolder(dir, '', {}, skipped);
      const all = Object.keys(loaded);
      if (!all.length) throw new Error('No text files found in that folder.');
      if (!window.confirm(`Load ${all.length} files from "${dir.name}" into your workspace copy? Files in your copy that are not in the folder will be removed.${skipped.count ? ` (${skipped.count} large or non-text files are skipped.)` : ''}`)) return;
      // Upload in chunks so each request stays small.
      let chunk = {}; let size = 0; let first = true;
      const flush = async () => {
        if (!Object.keys(chunk).length && !first) return;
        setStatus(`Uploading… ${Object.keys(chunk).length} files`);
        await post('workspace/import', { files: chunk, replace: first, keep: first ? all : undefined });
        chunk = {}; size = 0; first = false;
      };
      for (const p of all) {
        chunk[p] = loaded[p]; size += loaded[p].length;
        if (size > 1_000_000) await flush();
      }
      await flush();
      setFolder(dir); setBuffers({}); setSelected(null);
      await loadFiles(); onChanged?.();
    });
  };

  const tabs = [['code', 'Code'], ['preview', 'Live preview'], ['changes', `Changes${diff.files.length ? ` (${diff.files.length})` : ''}`]];
  const editorValue = selected ? current[selected] ?? '' : '';

  const preview = (
    <div className="flex h-full min-h-[360px] flex-col overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line bg-bg px-3 py-1.5 text-xs">
        <span className="size-2 rounded-full bg-ok" aria-hidden="true" />
        <span className="text-dim">Live from your files</span>
        {pages.length > 0 && (
          <select className="ml-auto max-w-[60%] rounded border border-line bg-surface px-1 py-0.5 font-mono text-ink" value={activePage} onChange={(e) => setPage(e.target.value)} aria-label="Page">
            {pages.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
      </div>
      {activePage
        ? <iframe title="Live preview" sandbox="allow-scripts allow-forms allow-modals" srcDoc={previewSrc} className="min-h-0 w-full flex-1 border-0 bg-white" />
        : <div className="grid flex-1 place-items-center p-6 text-center text-sm text-dim">Add an .html file to see a live preview.</div>}
    </div>
  );

  const editor = selected ? (
    <div className="flex h-full min-h-[360px] flex-col overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line bg-bg px-3 py-1.5">
        <span className="truncate font-mono text-xs">{selected}</span>
        {dirty.has(selected) && <Badge tone="amber">unsaved</Badge>}
        {!dirty.has(selected) && changed.has(selected) && <Badge tone="violet">changed</Badge>}
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          path={selected}
          language={langOf(selected)}
          value={editorValue}
          theme={document.documentElement.classList.contains('dark') || document.documentElement.dataset.theme === 'dark' ? 'vs-dark' : 'light'}
          options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: 'on', scrollBeyondLastLine: false, readOnly: !!busy, automaticLayout: true, tabSize: 2,
            // At the top or bottom of the file, the wheel scrolls the page instead of getting stuck.
            scrollbar: { alwaysConsumeMouseWheel: false } }}
          onChange={(v) => {
            const val = v ?? '';
            setBuffers((b) => {
              if (val === files[selected]) { const n = { ...b }; delete n[selected]; return n; }
              return { ...b, [selected]: val };
            });
          }}
          onMount={(ed, monaco) => {
            // Ctrl/Cmd+S saves the open file.
            ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current(selectedRef.current));
          }}
          loading={<div className="p-4 text-sm text-dim">Loading editor…</div>}
        />
      </div>
    </div>
  ) : <div className="grid h-full place-items-center rounded-lg border border-dashed border-line p-6 text-sm text-dim">Pick a file, or open a folder.</div>;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" className="min-h-9" onClick={openFolder} disabled={!!busy} title="Load a folder from your computer (Chrome / Edge)">📂 Open folder</Button>
        <Button size="sm" variant="secondary" className="min-h-9" onClick={newFile} disabled={!!busy}>+ New file</Button>
        <Button size="sm" className="min-h-9" onClick={saveAll} disabled={!dirty.size || !!busy}>Save{dirty.size > 1 ? ` all (${dirty.size})` : ''} <span className="font-normal opacity-70">Ctrl+S</span></Button>
        {folder && <span className="text-xs text-dim" title="Saves are also written to this folder">Synced with 📁 {folder.name}</span>}
        <span className="ml-auto text-xs text-dim" role="status">{busy ? <span className="animate-pulse text-accent">Agent is working in your copy (editing paused)…</span> : status}</span>
      </div>
      {error && <div role="alert" className="rounded-lg bg-err/10 px-3 py-2 text-sm text-err">{error}</div>}

      {task?.summary && SHOW_SUMMARY.includes(task.status) && !task.manual && (
        <Card tone="blue" className="!py-2.5">
          <div className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-accent">What the agent changed, in plain words</div>
          <p className="m-0 text-sm text-ink">{task.summary}</p>
        </Card>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
        <div className="max-h-48 w-full shrink-0 overflow-y-auto rounded-xl border border-line bg-surface p-2 md:max-h-none md:w-44">
          <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-dim">Your copy</div>
          <FileTree files={paths} changed={changed} dirty={dirty} selected={selected} onSelect={(p) => { setSelected(p); if (tab === 'changes') setTab('code'); }} onRename={renameFile} onDelete={deleteFile} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-1 border-b border-line">
            {tabs.map(([k, label]) => (
              <button
                type="button" key={k} onClick={() => setTab(k)}
                className={cx('-mb-px cursor-pointer border-0 border-b-2 bg-transparent px-3 py-2 text-sm font-medium',
                  tab === k ? 'border-accent text-accent' : 'border-transparent text-dim hover:text-ink')}
              >
                {label}
              </button>
            ))}
            {tab === 'code' && (
              <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-dim">
                <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> Preview beside code
              </label>
            )}
          </div>
          {diff.behindMain && tab === 'changes' && (
            <div className="rounded-lg bg-bg px-3 py-2 text-xs text-dim">The main project has moved on since your copy was made. Your diff is shown against the point where you started.</div>
          )}
          <div className="h-[calc(100dvh-15rem)] min-h-[420px] flex-1">
            {tab === 'code' && (split ? (
              <div className="grid h-full gap-3 xl:grid-cols-2">{editor}{preview}</div>
            ) : editor)}
            {tab === 'preview' && preview}
            {tab === 'changes' && <div className="h-full overflow-y-auto"><DiffViewer diff={diff.diff} empty="No changes in your copy yet. Edit a file, or give your agent a task." /></div>}
          </div>
        </div>
      </div>
    </div>
  );
}

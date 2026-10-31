// Parses a unified diff (git style) into files and lines for display.
export function parseDiff(diff) {
  const files = [];
  let cur = null;
  let oldNo = 0;
  let newNo = 0;
  for (const raw of String(diff || '').split('\n')) {
    if (raw.startsWith('diff --git')) {
      const m = raw.match(/ b\/(.+)$/);
      cur = { path: m?.[1] ?? '?', status: 'modified', added: 0, removed: 0, lines: [] };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith('new file')) { cur.status = 'added'; continue; }
    if (raw.startsWith('deleted file')) { cur.status = 'deleted'; continue; }
    if (raw.startsWith('index ') || raw.startsWith('--- ') || raw.startsWith('+++ ') || raw.startsWith('\\')) continue;
    if (raw.startsWith('@@')) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
      oldNo = Number(m?.[1] ?? 0);
      newNo = Number(m?.[2] ?? 0);
      cur.lines.push({ kind: 'hunk', text: raw });
      continue;
    }
    if (raw.startsWith('+')) { cur.added++; cur.lines.push({ kind: 'add', text: raw.slice(1), newNo: newNo++ }); continue; }
    if (raw.startsWith('-')) { cur.removed++; cur.lines.push({ kind: 'del', text: raw.slice(1), oldNo: oldNo++ }); continue; }
    if (raw.startsWith(' ')) cur.lines.push({ kind: 'ctx', text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ });
  }
  return files;
}

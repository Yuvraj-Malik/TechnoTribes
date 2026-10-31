// Path + key helpers shared by agents, the Moderator and the dependency graph.
// Graph keys: "file:<path>" for files, "req:<field>" for brief requirements.

export function normalizePath(p) {
  if (typeof p !== 'string') throw new Error('path must be a string');
  const clean = p.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  if (!clean || clean.length > 300) throw new Error(`invalid path "${p}"`);
  if (clean.split('/').some((seg) => seg === '..' || seg === '')) throw new Error(`invalid path "${p}"`);
  if (!/^[\w\-./@ ]+$/.test(clean)) throw new Error(`invalid characters in path "${p}"`);
  return clean;
}

export const fileKey = (path) => `file:${path}`;
export const reqKey = (field) => `req:${field}`;
export const isFileKey = (key) => key.startsWith('file:');
export const keyToPath = (key) => key.slice(5);

// Turn a graph key into words a non-technical person understands.
export function humanizeKey(key) {
  if (key.startsWith('req:')) return `the "${key.slice(4).replace(/[_-]/g, ' ')}" requirement`;
  if (key.startsWith('file:')) {
    const base = key.slice(5).split('/').pop().replace(/\.[^.]+$/, '');
    const words = base.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').trim();
    return `the ${words.toLowerCase() === 'index' ? 'main' : words} ${/page/i.test(key) ? 'page' : 'part'}`;
  }
  return key;
}

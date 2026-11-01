// Display helpers.
export const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', worker: 'Worker', observer: 'Observer' };

export function initials(name = '') {
  const parts = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}

export function timeAgo(date) {
  const s = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return 'just now';
  const units = [['minute', 60], ['hour', 3600], ['day', 86400], ['week', 604800], ['month', 2592000], ['year', 31536000]];
  let label = 'year';
  let size = 31536000;
  for (let i = units.length - 1; i >= 0; i--) {
    if (s >= units[i][1]) { [label, size] = units[i]; break; }
  }
  const n = Math.floor(s / size);
  return `${n} ${label}${n > 1 ? 's' : ''} ago`;
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function displayNameOf(user) {
  const meta = user?.user_metadata || {};
  return meta.display_name || meta.full_name || meta.name || user?.email?.split('@')[0] || 'there';
}

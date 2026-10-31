// A person's initials. Pass a colour to match them to their line on the branch map.
const initials = (name = '') => String(name || '').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

export default function Avatar({ name, color, className = 'size-8' }) {
  return (
    <span
      aria-hidden="true"
      style={color ? { borderColor: color } : undefined}
      className={`grid flex-none place-items-center rounded-full border-2 border-line bg-surface text-xs font-semibold ${className}`}
    >
      {initials(name)}
    </span>
  );
}

// The owner's navigation, quiet on purpose: text links, one soft highlight for the
// current page, and the account kept in the bottom corner. On phones the links
// become one row that scrolls sideways.
import { Link, NavLink } from 'react-router-dom';
import { Logo } from '../auth/BrandPanel';
import Avatar from '../common/Avatar';
import Icon from '../common/Icon';
import { focusRing } from '../common/styles';

const TABS = [
  { to: '', label: 'Overview', icon: 'overview', end: true },
  { to: 'brief', label: 'Brief', icon: 'brief' },
  { to: 'code', label: 'Code', icon: 'code' },
  { to: 'team', label: 'Team', icon: 'team' },
  { to: 'agents', label: 'My agents', icon: 'agents' },
  { to: 'messages', label: 'Messages', icon: 'messages' },
];
const SETTINGS = { to: 'settings', label: 'Settings', icon: 'settings' };

const rowClass = 'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm whitespace-nowrap max-md:min-h-11';

function TabLink({ base, tab, badge = 0, className = '' }) {
  return (
    <NavLink
      to={tab.to ? `${base}/${tab.to}` : base}
      end={tab.end}
      className={({ isActive }) => `${rowClass} ${isActive ? 'bg-ink/[0.07] font-semibold text-ink' : 'text-dim hover:text-ink'} ${focusRing} ${className}`}
    >
      <Icon name={tab.icon} />
      {tab.label}
      {badge > 0 && (
        <span className="ml-auto rounded-full bg-mark px-1.5 text-xs font-semibold text-[#14271c]">
          <span className="sr-only">, needs you: </span>
          {badge}
        </span>
      )}
    </NavLink>
  );
}

export default function OwnerSidebar({ projectId, projectName, version, ownerName, needsYouCount, onSignOut }) {
  const base = `/projects/${projectId}`;
  return (
    <aside className="sticky top-0 z-20 border-b border-line bg-bg md:fixed md:inset-y-0 md:left-0 md:flex md:w-56 md:flex-col md:border-r md:border-b-0">
      <div className="flex items-center justify-between gap-3 px-4 pt-3 md:block md:px-5 md:pt-6">
        <Logo className="text-lg! md:mb-6" />
        <Link
          to="/projects"
          title="Switch project"
          className={`flex min-w-0 items-center gap-1.5 rounded-lg text-ink max-md:min-h-11 md:-mx-1 md:px-1 md:py-1 md:hover:bg-ink/[0.05] ${focusRing}`}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{projectName}</span>
            <span className="hidden font-mono text-xs text-dim md:block">main · v{version}</span>
          </span>
          <Icon name="switch" className="size-4 text-dim" />
        </Link>
      </div>

      <nav aria-label="Project" className="flex gap-0.5 overflow-x-auto px-3 py-2 [scrollbar-width:none] md:flex-1 md:flex-col md:overflow-visible md:py-5">
        {TABS.map((tab) => (
          <TabLink key={tab.label} base={base} tab={tab} badge={tab.end ? needsYouCount : 0} />
        ))}
        <TabLink base={base} tab={SETTINGS} className="md:hidden" />
      </nav>

      <div className="hidden border-t border-line p-3 md:block">
        <TabLink base={base} tab={SETTINGS} />
        <button type="button" onClick={onSignOut} className={`${rowClass} w-full cursor-pointer border-0 bg-transparent text-dim hover:text-ink ${focusRing}`}>
          <Icon name="signout" />
          Sign out
        </button>
        <div className="mt-2 flex items-center gap-2.5 px-2.5 py-1.5">
          <Avatar name={ownerName} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{ownerName}</div>
            <div className="text-xs text-dim">Project owner</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

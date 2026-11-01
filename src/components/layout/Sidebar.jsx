// Sidebar: every tab lives here. Deep green to match the sign-in brand panel.
//   >= 1024px: always visible on the left.
//   <  1024px: slides in as a drawer from the hamburger in the navbar.
import { NavLink } from 'react-router-dom';
import { Logo } from '../auth/BrandPanel';
import Icon from '../common/Icon';
import { useNotifications } from '../../context/NotificationsContext';

const NAV = [
  { to: '/dashboard', label: 'Overview', icon: 'home', end: true },
  { to: '/dashboard/projects', label: 'My projects', icon: 'folder' },
  { to: '/dashboard/explore', label: 'Explore projects', icon: 'compass' },
  { to: '/dashboard/requests', label: 'My requests', icon: 'inbox' },
  { to: '/dashboard/notifications', label: 'Notifications', icon: 'bell', badge: 'unread' },
];

const ACTIONS = [
  { to: '/onboarding?start=founder', label: 'New project', icon: 'plus' },
  { to: '/onboarding?start=admin', label: 'Join with a code', icon: 'key' },
];

const linkBase = 'group relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] font-medium no-underline transition-colors focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-mark focus-visible:-outline-offset-1';

function Item({ item, onNavigate, unread }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) => `${linkBase} ${
        isActive ? 'bg-white/10 text-panel-ink' : 'text-panel-dim hover:bg-white/5 hover:text-panel-ink'
      }`}
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute top-2 bottom-2 -left-3 w-1 rounded-r bg-mark" aria-hidden="true" />}
          <Icon name={item.icon} size={19} />
          <span className="flex-1">{item.label}</span>
          {item.badge === 'unread' && unread > 0 && (
            <span className="min-w-6 rounded-full bg-mark px-1.5 text-center text-xs leading-6 font-semibold text-[#2a1d00]">
              {unread > 99 ? '99+' : unread}
              <span className="sr-only"> unread</span>
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

export default function Sidebar({ open, onClose, compact = false }) {
  // compact: tool pages (workspace, review) need the full width, so the sidebar is a drawer at every size.
  const lg = (cls) => (compact ? '' : cls);
  const { unread } = useNotifications();

  return (
    <>
      {/* Backdrop for the mobile drawer */}
      <div
        className={`fixed inset-0 z-40 bg-[rgba(8,20,13,0.55)] transition-opacity ${lg('lg:hidden')} ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        id="app-sidebar"
        aria-label="Main navigation"
        className={`fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col bg-panel text-panel-ink transition-transform duration-200 ease-out motion-reduce:transition-none ${lg('lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:w-64 lg:translate-x-0')} ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          backgroundImage: 'radial-gradient(140% 45% at 0% 100%, color-mix(in srgb, var(--accent) 18%, transparent) 0%, transparent 65%)',
          paddingLeft: 'env(safe-area-inset-left, 0px)',
        }}
      >
        <div className="flex h-16 items-center justify-between px-6">
          <Logo />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className={`grid size-11 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-panel-dim hover:text-panel-ink focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-mark ${lg('lg:hidden')}`}
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <nav className="flex flex-1 flex-col overflow-y-auto px-3 pt-4 pb-6">
          <ul className="m-0 flex list-none flex-col gap-1 p-0 pl-3">
            {NAV.map((item) => (
              <li key={item.to}><Item item={item} onNavigate={onClose} unread={unread} /></li>
            ))}
          </ul>

          <p className="m-0 mt-8 mb-2 pl-6 text-xs font-semibold tracking-[0.08em] text-panel-dim uppercase">Get started</p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 pl-3">
            {ACTIONS.map((item) => (
              <li key={item.to}><Item item={item} onNavigate={onClose} /></li>
            ))}
          </ul>

          <p className="m-0 mt-auto pt-8 pl-6 text-xs text-panel-dim">© {new Date().getFullYear()} Buildify</p>
        </nav>
      </aside>
    </>
  );
}

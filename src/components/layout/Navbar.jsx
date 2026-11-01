// Top bar: page title on the left; theme, notifications and profile on the right.
// Inside a project, that project's tabs (by role) sit in a row under the bar.
import { Link, NavLink, useLocation } from 'react-router-dom';
import Icon from '../common/Icon';
import Popover from '../common/Popover';
import { focusRing } from '../common/styles';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationsContext';
import { useTheme } from '../../hooks/useTheme';
import { useShell } from '../../context/ShellContext';
import { displayNameOf, initials, timeAgo } from '../../utils/format';

const TITLES = [
  ['/dashboard/projects', 'My projects'],
  ['/dashboard/explore', 'Explore projects'],
  ['/dashboard/requests', 'My requests'],
  ['/dashboard/notifications', 'Notifications'],
  ['/dashboard', 'Overview'],
  ['/p/', 'Project'],
  ['/projects/', 'Project'],
];

const iconButton = `relative grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border border-line bg-surface text-dim hover:text-ink ${focusRing}`;

function NotificationBell() {
  const { items, unread, markRead } = useNotifications();
  const latest = items.slice(0, 6);

  return (
    <Popover
      label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
      panelClassName="w-[min(360px,calc(100vw-32px))] max-sm:fixed max-sm:top-16 max-sm:right-4"
      button={(props) => (
        <button type="button" {...props} className={iconButton}>
          <Icon name="bell" size={19} />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 grid h-5 min-w-5 place-items-center rounded-full border-2 border-bg bg-mark px-1 text-[11px] leading-none font-bold text-[#2a1d00]">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="font-semibold">Notifications</span>
            {unread > 0 && (
              <button type="button" onClick={() => markRead()} className={`min-h-9 cursor-pointer border-0 bg-transparent text-sm font-semibold text-accent ${focusRing}`}>
                Mark all read
              </button>
            )}
          </div>
          {latest.length === 0 ? (
            <p className="m-0 px-4 py-8 text-center text-sm text-dim">You are all caught up.</p>
          ) : (
            <ul className="m-0 max-h-[360px] list-none overflow-y-auto p-0">
              {latest.map((n) => (
                <li key={n.id} className="flex gap-3 border-b border-line px-4 py-3 last:border-0">
                  <span className={`mt-2 size-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-accent'}`} aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="m-0 text-sm font-semibold">{n.title}{!n.read && <span className="sr-only"> (unread)</span>}</p>
                    {n.body && <p className="m-0 mt-0.5 line-clamp-2 text-[13px] text-dim">{n.body}</p>}
                    <p className="m-0 mt-1 text-xs text-dim">{timeAgo(n.created_at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Link to="/dashboard/notifications" onClick={close} className={`flex min-h-11 items-center justify-center border-t border-line text-sm font-semibold text-accent no-underline hover:bg-bg ${focusRing}`}>
            View all notifications
          </Link>
        </div>
      )}
    </Popover>
  );
}

function ProfileMenu() {
  const { user, signOut } = useAuth();
  const { dark, toggle } = useTheme();
  const name = displayNameOf(user);
  const avatar = user?.user_metadata?.avatar_url;

  return (
    <Popover
      label="Account menu"
      panelClassName="w-64"
      button={(props) => (
        <button type="button" {...props} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line bg-surface py-1 pr-2 pl-1 text-ink sm:pr-3 ${focusRing}`}>
          {avatar
            ? <img src={avatar} alt="" referrerPolicy="no-referrer" className="size-9 rounded-full object-cover" />
            : <span className="grid size-9 place-items-center rounded-full bg-accent text-sm font-bold text-accent-ink">{initials(name)}</span>}
          <span className="hidden max-w-[140px] truncate text-sm font-semibold sm:block">{name}</span>
          <Icon name="chevronDown" size={16} className="hidden text-dim sm:block" />
        </button>
      )}
    >
      <div className="border-b border-line px-4 py-3">
        <p className="m-0 truncate font-semibold">{name}</p>
        <p className="m-0 truncate text-sm text-dim">{user?.email}</p>
      </div>
      <div className="p-1.5">
        <button type="button" onClick={toggle} className={`flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg border-0 bg-transparent px-3 text-left text-[15px] text-ink hover:bg-bg ${focusRing}`}>
          <Icon name={dark ? 'sun' : 'moon'} size={18} className="text-dim" />
          {dark ? 'Light mode' : 'Dark mode'}
        </button>
        <button type="button" onClick={signOut} className={`flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg border-0 bg-transparent px-3 text-left text-[15px] text-err hover:bg-bg ${focusRing}`}>
          <Icon name="logout" size={18} />
          Sign out
        </button>
      </div>
    </Popover>
  );
}

/** Inside a project: that project's role-specific tabs, as a row under the top bar. */
function ProjectTabs({ items }) {
  return (
    <nav aria-label="Project" className="-mb-px flex gap-1 overflow-x-auto px-2 sm:px-4 lg:px-6 [scrollbar-width:none]">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold whitespace-nowrap no-underline transition-colors ${focusRing} ${
            isActive ? 'border-accent text-accent' : 'border-transparent text-dim hover:text-ink'}`}
        >
          <Icon name={item.icon} size={16} />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function Navbar({ onMenu, menuOpen, compact = false }) {
  const { pathname } = useLocation();
  const { dark, toggle } = useTheme();
  const { section } = useShell();
  const title = (section && pathname.startsWith('/projects/') && section.title)
    || TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] || 'Buildify';

  const tabs = section && pathname.startsWith('/projects/') ? section.items : null;

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-md">
    <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Open menu"
        aria-controls="app-sidebar"
        aria-expanded={menuOpen}
        className={`${iconButton} ${compact ? '' : 'lg:hidden'}`}
      >
        <Icon name="menu" size={20} />
      </button>
      <p className="m-0 min-w-0 flex-1 truncate font-display text-lg font-bold tracking-[-0.01em]">{title}</p>
      <button type="button" onClick={toggle} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} className={`${iconButton} max-sm:hidden`}>
        <Icon name={dark ? 'sun' : 'moon'} size={19} />
      </button>
      <NotificationBell />
      <ProfileMenu />
    </div>
    {tabs && <ProjectTabs items={tabs} />}
    </header>
  );
}

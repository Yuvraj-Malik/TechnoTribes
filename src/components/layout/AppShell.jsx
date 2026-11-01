// Layout for every signed-in page: sidebar (tabs) + navbar (account) + page content.
// Project workspace pages (/projects/:id/...) use the full width and height,
// because they are multi-panel tools.
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Navbar from './Navbar';
import { NotificationsProvider } from '../../context/NotificationsContext';
import { ShellProvider } from '../../context/ShellContext';

export default function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const workspace = pathname.startsWith('/projects/');
  const tool = /^\/projects\/[^/]+\/(workspace|review)\/?$/.test(pathname);

  useEffect(() => { setMenuOpen(false); }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  return (
    <NotificationsProvider>
      <ShellProvider>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2">
          Skip to content
        </a>
        <div className="flex min-h-dvh">
          <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} compact={tool} />
          <div className="flex min-w-0 flex-1 flex-col">
            <Navbar onMenu={() => setMenuOpen(true)} menuOpen={menuOpen} compact={tool} />
            {workspace ? (
              <main id="main" className="flex min-h-0 w-full flex-1 flex-col lg:h-[calc(100dvh-4rem-2.75rem)]">
                <Outlet />
              </main>
            ) : (
              <main id="main" className="mx-auto w-full max-w-[1200px] flex-1 px-4 pt-6 pb-16 sm:px-6 sm:pt-8 lg:px-10 lg:pt-10">
                <Outlet />
              </main>
            )}
          </div>
        </div>
      </ShellProvider>
    </NotificationsProvider>
  );
}

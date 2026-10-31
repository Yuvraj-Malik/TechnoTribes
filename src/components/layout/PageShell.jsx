// Page frame for project screens: brand, theme toggle and sign out.
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Logo } from '../auth/BrandPanel';
import ThemeToggle from '../common/ThemeToggle';
import { focusRing } from '../common/styles';

export default function PageShell({ children }) {
  const { signOut } = useAuth();
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-6">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <Logo />
        <div className="flex items-center gap-3">
          <Link to="/projects" className={`inline-flex min-h-11 items-center text-[13px] font-medium text-dim underline ${focusRing}`}>All projects</Link>
          <ThemeToggle />
          <button type="button" onClick={signOut} className={`min-h-11 shrink-0 cursor-pointer rounded-full border border-line bg-surface px-3.5 text-[13px] font-medium text-dim ${focusRing}`}>
            Sign out
          </button>
        </div>
      </header>
      {children}
    </div>
  );
}

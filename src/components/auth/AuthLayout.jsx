// Two-column layout shared by every auth screen. `top` sits above the card (tabs, theme toggle).
import BrandPanel from './BrandPanel';
import ThemeToggle from '../common/ThemeToggle';

export default function AuthLayout({ top, children }) {
  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:items-start">
      <BrandPanel />
      {/* Pinned to a fixed distance from the top (not centered), so switching
          between log in and sign up never shifts the tabs or the title. */}
      <main className="flex justify-center px-6 py-10 md:min-h-screen md:pt-[max(48px,11vh)]">
        <div className="w-full max-w-[440px]">
          <div className="mb-6 flex items-center justify-between gap-3">
            {top ?? <span />}
            <ThemeToggle />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

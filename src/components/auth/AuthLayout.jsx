// Two-column layout shared by every auth screen. `top` sits above the card (tabs, theme toggle).
import BrandPanel from './BrandPanel';
import ThemeToggle from '../common/ThemeToggle';

export default function AuthLayout({ top, children }) {
  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <BrandPanel />
      <main className="flex items-start justify-center px-6 py-8 md:pt-[clamp(3rem,8vh,5rem)] md:pb-12 overflow-y-auto">
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

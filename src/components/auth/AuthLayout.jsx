// Shared layout for every auth screen.
//   Laptop / tablet landscape (>= 1024px): two columns, brand panel pinned on the left.
//   Tablet portrait and phones (< 1024px): compact brand banner on top, form centered below.
// The form is pinned to a fixed top offset (not vertically centered), so switching
// between log in and sign up never shifts the tabs or the title.
import BrandPanel from './BrandPanel';
import ThemeToggle from '../common/ThemeToggle';

export default function AuthLayout({ top, children }) {
  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start">
      <BrandPanel />
      <main className="flex justify-center px-5 pt-7 pb-10 sm:px-8 sm:pt-12 sm:pb-16 [@media(max-height:520px)_and_(max-width:1023px)]:pt-6 lg:min-h-dvh lg:pt-[max(48px,11vh)]">
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

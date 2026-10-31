// Brand panel.
//   >= 1024px: full-height left column, pinned while the form scrolls.
//   <  1024px: compact banner above the form (smaller still on phones).

export function Logo({ className = '' }) {
  return (
    <div className={`flex items-center gap-2.5 font-display text-xl font-bold tracking-[-0.01em] sm:text-2xl ${className}`}>
      <i className="inline-block size-3 rotate-45 rounded-[3px] bg-mark sm:size-3.5" aria-hidden="true" />
      Buildify
    </div>
  );
}

// Large outline of the logo diamond, cropped by the corner.
function Mark() {
  return (
    <svg
      className="pointer-events-none absolute -right-[22%] -bottom-[26%] hidden aspect-square w-[85%] max-w-[720px] text-panel-ink sm:block [@media(max-height:520px)_and_(max-width:1023px)]:hidden sm:-right-[8%] sm:-bottom-[60%] sm:w-[48%] lg:-right-[22%] lg:-bottom-[26%] lg:w-[85%]"
      viewBox="0 0 200 200"
      fill="none"
      aria-hidden="true"
    >
      <rect x="40" y="40" width="120" height="120" rx="14" transform="rotate(45 100 100)" stroke="currentColor" strokeOpacity="0.09" strokeWidth="1" />
      <rect x="62" y="62" width="76" height="76" rx="10" transform="rotate(45 100 100)" stroke="currentColor" strokeOpacity="0.07" strokeWidth="1" />
      <rect x="84" y="84" width="32" height="32" rx="5" transform="rotate(45 100 100)" fill="var(--mark)" fillOpacity="0.1" />
    </svg>
  );
}

export default function BrandPanel() {
  return (
    <aside
      className="relative isolate flex flex-col overflow-hidden bg-panel px-5 pt-5 pb-6 text-panel-ink sm:px-8 sm:pt-8 sm:pb-10 [@media(max-height:520px)_and_(max-width:1023px)]:py-4 lg:sticky lg:top-0 lg:h-dvh lg:px-14 lg:py-12"
      style={{
        backgroundImage:
          'radial-gradient(120% 70% at 0% 100%, color-mix(in srgb, var(--accent) 22%, transparent) 0%, transparent 60%),'
          + 'radial-gradient(80% 50% at 100% 0%, color-mix(in srgb, var(--mark) 8%, transparent) 0%, transparent 70%)',
      }}
    >
      <Mark />
      <Logo />

      <div className="mt-4 sm:mt-8 [@media(max-height:520px)_and_(max-width:1023px)]:mt-2 lg:my-auto lg:max-w-[520px]">
        <h2 className="m-0 font-display text-[24px] leading-[1.08] font-bold tracking-[-0.025em] sm:text-[36px] [@media(max-height:520px)_and_(max-width:1023px)]:text-[22px] lg:text-[clamp(40px,3.6vw,58px)]">
          Build together. <br className="hidden sm:inline [@media(max-height:520px)_and_(max-width:1023px)]:hidden" />
          <span className="text-mark">Stay in control.</span>
        </h2>
        <p className="m-0 mt-3 hidden max-w-[36ch] text-panel-dim sm:block [@media(max-height:520px)_and_(max-width:1023px)]:hidden sm:text-[17px] lg:mt-6 lg:text-lg lg:leading-relaxed">
          The shared workspace for product teams and their AI agents.
        </p>
      </div>

      <footer className="hidden text-[13px] text-panel-dim lg:block">
        © {new Date().getFullYear()} Buildify
      </footer>
    </aside>
  );
}

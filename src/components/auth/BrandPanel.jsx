// Left-hand brand panel: deep green, logo, one centered statement, footer.
// On desktop it stays fixed to the viewport, so it never moves with the form.

export function Logo({ className = '' }) {
  return (
    <div className={`flex items-center gap-2.5 font-display text-2xl font-bold tracking-[-0.01em] ${className}`}>
      <i className="inline-block size-3.5 rotate-45 rounded-[3px] bg-mark" aria-hidden="true" />
      Buildify
    </div>
  );
}

// Large outline of the logo diamond, cropped by the bottom-right corner.
function Mark() {
  return (
    <svg
      className="pointer-events-none absolute -right-[22%] -bottom-[26%] hidden aspect-square w-[85%] max-w-[720px] text-panel-ink md:block"
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
      className="relative isolate flex flex-col overflow-hidden bg-panel px-6 py-7 text-panel-ink md:sticky md:top-0 md:h-screen md:px-14 md:py-12"
      style={{
        backgroundImage:
          'radial-gradient(120% 70% at 0% 100%, color-mix(in srgb, var(--accent) 22%, transparent) 0%, transparent 60%),'
          + 'radial-gradient(80% 50% at 100% 0%, color-mix(in srgb, var(--mark) 8%, transparent) 0%, transparent 70%)',
      }}
    >
      <Mark />
      <Logo />

      <div className="mt-5 md:my-auto md:max-w-[520px]">
        <h2 className="m-0 font-display text-[28px] leading-[1.08] font-bold tracking-[-0.025em] md:text-[clamp(40px,3.6vw,58px)]">
          Build together.
          <br />
          <span className="text-mark">Stay in control.</span>
        </h2>
        <p className="m-0 mt-4 max-w-[36ch] text-panel-dim md:mt-6 md:text-lg md:leading-relaxed">
          The shared workspace for product teams and their AI agents.
        </p>
      </div>

      <footer className="hidden text-[13px] text-panel-dim md:block">
        © {new Date().getFullYear()} Buildify
      </footer>
    </aside>
  );
}

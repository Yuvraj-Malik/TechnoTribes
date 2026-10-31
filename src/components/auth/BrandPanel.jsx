// Left-hand panel: logo, pitch and an example of the workspace timeline.
const TIMELINE = [
  { pip: 'bg-pip-ok', who: 'Priya', what: 'saved brief v1', note: 'Agents can now start working' },
  { pip: 'bg-pip-b', who: 'Builder', what: 'proposed a Hero section', note: 'Waiting for approval' },
  { pip: 'bg-pip-w', who: 'Audience changed', what: '(v2)', note: '2 items are now out of date' },
  { pip: 'bg-pip-ok', who: 'Arjun', what: 'approved the new pricing', note: 'Decision recorded' },
];

export function Logo() {
  return (
    <div className="flex items-center gap-2.5 font-display text-2xl font-bold tracking-[-0.01em]">
      <i className="inline-block size-3.5 rotate-45 rounded-[3px] bg-mark" aria-hidden="true" />
      Buildify
    </div>
  );
}

export default function BrandPanel() {
  return (
    <aside className="flex flex-col gap-[18px] bg-panel px-6 py-7 text-panel-ink md:gap-8 md:px-12 md:pt-12 md:pb-10">
      <Logo />
      <div>
        <h2 className="m-0 max-w-[16ch] font-display text-[26px] leading-[1.12] font-bold tracking-[-0.02em] md:text-[34px]">
          One workspace for founders, teams and their AI agents.
        </h2>
        <p className="m-0 mt-3.5 max-w-[40ch] text-panel-dim">
          See what changed, why it changed, and who decided. No code reading needed.
        </p>
      </div>
      <div
        aria-label="Example of the workspace timeline"
        className="mt-auto hidden rounded-[10px] border border-log-line bg-log-bg px-[18px] py-1.5 md:block"
      >
        {TIMELINE.map((item, i) => (
          <div
            key={item.who}
            style={{ animationDelay: `${i * 0.25}s` }}
            className="flex gap-3 border-b border-log-line py-3 text-[14.5px] last:border-0 motion-safe:animate-rise"
          >
            <span className={`mt-1.5 size-2.5 flex-none rounded-full ${item.pip}`} />
            <span>
              <b className="font-semibold">{item.who}</b> {item.what}
              <small className="block text-[13px] text-panel-dim">{item.note}</small>
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}

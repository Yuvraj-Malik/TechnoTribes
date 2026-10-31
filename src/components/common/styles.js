// Shared Tailwind class strings, so every control looks and focuses the same way.
export const focusRing =
  'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-mark focus-visible:outline-offset-2';

export const primaryButton =
  `w-full cursor-pointer rounded-[10px] border-0 bg-accent p-3.5 text-base font-semibold text-accent-ink hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;

export const linkButton =
  `inline-flex min-h-11 cursor-pointer items-center border-0 bg-transparent p-0 text-sm font-semibold text-accent underline ${focusRing}`;

export const heading = 'm-0 mb-1.5 font-display text-[26px] sm:text-[30px] leading-[1.15] font-bold tracking-[-0.02em]';
export const subheading = 'm-0 mb-[22px] text-dim';

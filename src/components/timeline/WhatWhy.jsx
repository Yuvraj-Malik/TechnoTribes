// What changed and why, side by side with the app's green and amber tints.
export default function WhatWhy({ what, why, whatLabel = 'What changed' }) {
  if (!what && !why) return null;
  return (
    <div className="mt-3 grid gap-2 text-sm">
      {what && (
        <div className="rounded-lg bg-ok/8 px-3 py-2">
          <p className="m-0 text-[11px] font-bold tracking-wide text-ok uppercase">{whatLabel}</p>
          <p className="m-0 mt-0.5 text-ink">{what}</p>
        </div>
      )}
      {why && (
        <div className="rounded-lg bg-mark/12 px-3 py-2">
          <p className="m-0 text-[11px] font-bold tracking-wide text-ink/70 uppercase">Why</p>
          <p className="m-0 mt-0.5 text-ink">{why}</p>
        </div>
      )}
    </div>
  );
}

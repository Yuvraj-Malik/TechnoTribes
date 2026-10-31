// Smoothly opens/closes its content by animating height (via grid rows),
// so things below slide instead of jumping. Hidden content can't be focused.
export default function Collapse({ open, children }) {
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}
      inert={!open}
      aria-hidden={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

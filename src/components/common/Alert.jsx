// Inline message box for form-level errors and confirmations.
export default function Alert({ tone = 'error', children }) {
  if (!children) return null;
  const styles = tone === 'error'
    ? 'border-err text-err'
    : 'border-ok text-ok';
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`mb-4 rounded-lg border-[1.5px] bg-surface px-3.5 py-3 text-sm ${styles}`}>
      {children}
    </div>
  );
}

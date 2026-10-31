import { heading } from './styles';

export default function PageHeader({ title, children, actions }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h1 className={heading}>{title}</h1>
        {children && <p className="m-0 max-w-2xl text-dim">{children}</p>}
      </div>
      {actions}
    </header>
  );
}

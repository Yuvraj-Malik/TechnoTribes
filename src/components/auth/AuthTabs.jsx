import { focusRing } from '../common/styles';

const TABS = [
  { id: 'login', label: 'Log in' },
  { id: 'signup', label: 'Sign up' },
];

export default function AuthTabs({ mode, onChange }) {
  return (
    <div role="tablist" aria-label="Account" className="inline-flex rounded-full border border-line bg-surface p-1">
      {TABS.map((tab) => {
        const selected = mode === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={`cursor-pointer rounded-full border-0 px-[18px] py-2 text-sm font-semibold ${
              selected ? 'bg-accent text-accent-ink' : 'bg-transparent text-dim'
            } ${focusRing}`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

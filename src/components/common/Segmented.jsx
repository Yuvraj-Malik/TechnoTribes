// Switches between a few views of the same thing.
import { focusRing } from './styles';

export default function Segmented({ label, options, value, onChange }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap rounded-full border border-line bg-surface p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={`cursor-pointer rounded-full border-0 px-3.5 py-1.5 text-[13px] font-medium max-lg:min-h-11 ${focusRing} ${option.value === value ? 'bg-ink text-bg' : 'bg-transparent text-dim hover:text-ink'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

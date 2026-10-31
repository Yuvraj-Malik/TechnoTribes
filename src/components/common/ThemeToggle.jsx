import { useTheme } from '../../hooks/useTheme';
import { focusRing } from './styles';

export default function ThemeToggle() {
  const { dark, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      className={`min-h-11 shrink-0 cursor-pointer rounded-full border border-line bg-surface px-3.5 text-[13px] font-medium text-dim ${focusRing}`}
    >
      {dark ? 'Light mode' : 'Dark mode'}
    </button>
  );
}

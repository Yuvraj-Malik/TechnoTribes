import { useTheme } from '../../hooks/useTheme';
import { focusRing } from './styles';

export default function ThemeToggle() {
  const { dark, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      className={`cursor-pointer rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-dim ${focusRing}`}
    >
      {dark ? 'Light mode' : 'Dark mode'}
    </button>
  );
}

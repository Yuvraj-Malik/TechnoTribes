// Light/dark toggle. Follows the OS until the user picks, then remembers the choice.
import { useCallback, useEffect, useState } from 'react';

const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

function currentIsDark() {
  const set = document.documentElement.getAttribute('data-theme');
  return set ? set === 'dark' : prefersDark();
}

export function useTheme() {
  const [dark, setDark] = useState(currentIsDark);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDark(currentIsDark());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    const next = currentIsDark() ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch { /* storage may be blocked */ }
    setDark(next === 'dark');
  }, []);

  return { dark, toggle };
}

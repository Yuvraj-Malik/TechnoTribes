// Light/dark toggle. Follows the OS until the user picks, then remembers the choice.
// Every component using this hook stays in sync (navbar icon, profile menu, auth pages).
import { useCallback, useEffect, useState } from 'react';

const EVENT = 'buildify:themechange';
const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

function currentIsDark() {
  const set = document.documentElement.getAttribute('data-theme');
  return set ? set === 'dark' : prefersDark();
}

export function useTheme() {
  const [dark, setDark] = useState(currentIsDark);

  useEffect(() => {
    const sync = () => setDark(currentIsDark());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', sync);
    window.addEventListener(EVENT, sync);
    return () => {
      mq.removeEventListener('change', sync);
      window.removeEventListener(EVENT, sync);
    };
  }, []);

  const toggle = useCallback(() => {
    const next = currentIsDark() ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch { /* storage may be blocked */ }
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { dark, toggle };
}

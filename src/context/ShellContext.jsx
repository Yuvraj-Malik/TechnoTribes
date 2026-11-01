// Lets a page inside the app shell add its own tabs to the sidebar and set the
// navbar title (used by the project workspace).
import { createContext, useContext, useEffect, useState } from 'react';

const ShellContext = createContext({ section: null, setSection: () => {} });

export function ShellProvider({ children }) {
  const [section, setSection] = useState(null);
  return <ShellContext.Provider value={{ section, setSection }}>{children}</ShellContext.Provider>;
}

export function useShell() {
  return useContext(ShellContext);
}

// section: { title, subtitle, items: [{ to, label, icon, end? }] }
export function useShellSection(section) {
  const { setSection } = useShell();
  const key = JSON.stringify(section);
  useEffect(() => {
    setSection(section);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setSection]);
  useEffect(() => () => setSection(null), [setSection]);
}

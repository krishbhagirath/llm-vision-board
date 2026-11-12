import { useEffect, useState } from 'react';
import { useSettings } from './useSettings';

/** Applies the `.dark` class to <html> from settings.theme. Returns the resolved theme. */
export function useTheme(): 'light' | 'dark' {
  const settings = useSettings();
  const pref = settings?.theme ?? 'system';
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const resolved = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
  }, [resolved]);
  return resolved;
}

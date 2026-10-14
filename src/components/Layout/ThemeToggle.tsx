import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'drone-ui-theme';
function savedTheme(): Theme | null {
  try { const value = localStorage.getItem(STORAGE_KEY); return value === 'light' || value === 'dark' ? value : null; }
  catch { return null; }
}
function preferredTheme(): Theme { return savedTheme() ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }

/** Presentation preference only; mission state and exported JSON are unchanged. */
export function ThemeToggle({ disabled = false }: { disabled?: boolean }) {
  const [theme, setTheme] = useState<Theme>(preferredTheme);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-color-scheme: dark)');
    const followSystem = () => { if (!savedTheme()) setTheme(preference.matches ? 'dark' : 'light'); };
    preference.addEventListener('change', followSystem);
    return () => preference.removeEventListener('change', followSystem);
  }, []);
  const label = theme === 'light' ? 'Passer au thème sombre' : 'Passer au thème clair';
  return <button className="theme-toggle" disabled={disabled} aria-label={label} title={label} onClick={() => {
    const next = theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* Theme remains usable without storage. */ }
    setTheme(next);
  }}><span aria-hidden="true">{theme === 'light' ? '☾' : '☀'}</span></button>;
}

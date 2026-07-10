import { useEffect, useLayoutEffect, useState } from 'react';

const KEY = 'theme';
const DARK_THEME = 'dark';
const LIGHT_THEME = 'light';
type Theme = typeof DARK_THEME | typeof LIGHT_THEME;
const DEFAULT_THEME: Theme = 'dark';

export default function useTheme() {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);

  function toggleTheme() {
    if (theme === DARK_THEME) {
      document.body.classList.replace(DARK_THEME, LIGHT_THEME);
      localStorage.setItem(KEY, LIGHT_THEME);
      setTheme(LIGHT_THEME);
    } else {
      document.body.classList.replace(LIGHT_THEME, DARK_THEME);
      localStorage.setItem(KEY, DARK_THEME);
      setTheme(DARK_THEME);
    }
  }

  useEffect(() => {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setTheme(DARK_THEME);
    } else {
      setTheme(LIGHT_THEME);
    }
  }, []);

  useEffect(() => {
    document.body.classList.add(theme);
  }, [theme]);

  return { toggleTheme, theme };
}

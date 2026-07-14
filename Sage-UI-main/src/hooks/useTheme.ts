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
    // classList.add alone never removed the OTHER theme's class — the very
    // first render adds the default ('dark'), then the media-query effect
    // above often flips state to 'light' a tick later, adding THAT too on
    // top instead of replacing it. Both classes stuck on <body>
    // simultaneously means every themed rule exists twice with identical
    // specificity (.dark X and .light X), so whichever one happens to
    // compile later in the stylesheet silently wins per-property — the
    // actual cause of scattered wrong-theme-color bugs (this one: modal
    // description text rendering near-white on a light background).
    document.body.classList.remove(DARK_THEME, LIGHT_THEME);
    document.body.classList.add(theme);
  }, [theme]);

  return { toggleTheme, theme };
}

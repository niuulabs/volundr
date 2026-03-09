import { useState, useEffect, useCallback } from 'react';
import type { ThemeId } from './themes';
import { THEMES, STORAGE_KEY } from './themes';
import { ThemeContext } from './themeContextValue';

function applyTheme(id: ThemeId) {
  if (id === 'default') {
    document.documentElement.removeAttribute('data-theme');
    return;
  }
  document.documentElement.setAttribute('data-theme', id);
}

function loadStoredTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && THEMES.some(t => t.id === stored)) {
      return stored as ThemeId;
    }
  } catch {
    // localStorage unavailable
  }
  return 'default';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(loadStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((id: ThemeId) => {
    setThemeState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // localStorage unavailable
    }
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

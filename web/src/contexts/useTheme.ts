import { useContext } from 'react';
import { ThemeContext } from './themeContextValue';

export function useTheme() {
  return useContext(ThemeContext);
}

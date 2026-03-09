export type ThemeId = 'default' | 'spring';

export interface ThemeOption {
  id: ThemeId;
  label: string;
}

export const THEMES: ThemeOption[] = [
  { id: 'default', label: 'Volundr Amber' },
  { id: 'spring', label: 'Spring Green' },
];

export const STORAGE_KEY = 'volundr-theme';

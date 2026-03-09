import { THEMES } from '@/contexts/themes';
import type { ThemeId } from '@/contexts/themes';
import { useTheme } from '@/contexts/useTheme';
import styles from './AppearanceSection.module.css';

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
    <div className={styles.section}>
      <h3 className={styles.heading}>Theme</h3>
      <p className={styles.description}>Choose a brand color scheme for the UI.</p>

      <div className={styles.grid}>
        {THEMES.map(opt => (
          <button
            key={opt.id}
            type="button"
            className={`${styles.card}${theme === opt.id ? ` ${styles.cardActive}` : ''}`}
            onClick={() => setTheme(opt.id as ThemeId)}
            data-theme-id={opt.id}
          >
            <span className={styles.swatch} data-theme-id={opt.id} />
            <span className={styles.label}>{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

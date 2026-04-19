import { Rune, StateDot } from '@niuulabs/ui';
import { usePersonas } from './usePersonas';
import styles from './RavnPage.module.css';

export function RavnPage() {
  const { data, isLoading, isError, error } = usePersonas();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Rune glyph="ᚱ" size={32} />
        <h2 className={styles.title}>Ravn · the flock</h2>
      </header>

      <p className={styles.subtitle}>agent fleet console — coming soon</p>

      {isLoading && (
        <div className={styles.state}>
          <StateDot state="processing" pulse />
          <span>loading personas…</span>
        </div>
      )}

      {isError && (
        <div className={styles.state}>
          <StateDot state="failed" />
          <span>{error instanceof Error ? error.message : 'unknown error'}</span>
        </div>
      )}

      {data && (
        <ul className={styles.list}>
          {data.map((p) => (
            <li key={p.name} className={styles.item}>
              <span className={styles.personaName}>{p.name}</span>
              <span className={styles.personaMode}>{p.permissionMode}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

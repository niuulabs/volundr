import { Rune } from '@niuulabs/ui';
import styles from './VolundrPage.module.css';

/**
 * Placeholder page for the Völundr plugin.
 *
 * Full implementation (Sessions, Templates, Clusters, History) follows in
 * subsequent tickets that build on this scaffold.
 */
export function VolundrPage() {
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Rune glyph="ᚲ" size={40} />
        <div className={styles.titleGroup}>
          <h2 className={styles.title}>Völundr · session forge</h2>
          <p className={styles.subtitle}>Provision and manage remote dev sessions</p>
        </div>
      </div>
      <div className={styles.body}>
        <p className={styles.coming}>
          Full UI coming soon — domain, ports, and mock adapter are ready.
        </p>
      </div>
    </div>
  );
}

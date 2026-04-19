import { Rune } from '@niuulabs/ui';
import { useRegistry } from './useRegistry';
import { useTopologyStream } from './useTopologyStream';
import { TopologyCanvas } from './TopologyCanvas';
import styles from './ObservatoryPage.module.css';

export function ObservatoryPage() {
  const { data: registry } = useRegistry();
  const snapshot = useTopologyStream();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Rune glyph="ᚠ" size={20} title="Flokk Observatory" />
        <h2 className={styles.title}>Flokk · Observatory</h2>
        {registry && (
          <span className={styles.meta}>
            {registry.types.length} types · v{registry.version}
          </span>
        )}
      </header>

      <div className={styles.canvas}>
        <TopologyCanvas snapshot={snapshot} showMinimap />
      </div>
    </div>
  );
}

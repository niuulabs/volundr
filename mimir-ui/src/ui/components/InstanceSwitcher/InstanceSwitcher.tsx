import type { InstanceRole } from '@/domain';
import styles from './InstanceSwitcher.module.css';

interface InstanceTab {
  name: string;
  role: InstanceRole;
  writeEnabled: boolean;
}

interface InstanceSwitcherProps {
  instances: InstanceTab[];
  activeName: string;
  onChange: (name: string) => void;
}

export function InstanceSwitcher({ instances, activeName, onChange }: InstanceSwitcherProps) {
  return (
    <nav className={styles.switcher} aria-label="Mímir instances">
      {instances.map((instance) => (
        <button
          key={instance.name}
          className={styles.tab}
          data-active={instance.name === activeName}
          data-role={instance.role}
          onClick={() => onChange(instance.name)}
          aria-pressed={instance.name === activeName}
        >
          <span className={styles.roleDot} data-role={instance.role} aria-hidden="true" />
          <span className={styles.tabName}>{instance.name}</span>
          {instance.writeEnabled && (
            <span className={styles.writeBadge} title="Write enabled">
              rw
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}

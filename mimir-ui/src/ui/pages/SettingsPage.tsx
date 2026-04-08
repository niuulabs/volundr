import { useState } from 'react';
import type { InstanceRole } from '@/domain';
import { usePorts } from '@/contexts/PortsContext';
import type { InstancePorts } from '@/contexts/PortsContext';
import styles from './SettingsPage.module.css';

function roleBadgeVariant(role: InstanceRole): string {
  if (role === 'local') return 'role-local';
  if (role === 'shared') return 'role-shared';
  return 'role-domain';
}

interface InstanceCardProps {
  instancePorts: InstancePorts;
  isActive: boolean;
}

function InstanceCard({ instancePorts, isActive }: InstanceCardProps) {
  const [open, setOpen] = useState(isActive);
  const { instance } = instancePorts;

  function handleToggle() {
    setOpen((prev) => !prev);
  }

  return (
    <div className={styles.instanceCard} data-active={isActive ? 'true' : 'false'}>
      <div
        className={styles.instanceCardHeader}
        onClick={handleToggle}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleToggle();
        }}
      >
        <h3 className={styles.instanceName}>{instance.name}</h3>
        <div className={styles.instanceBadges}>
          {isActive && (
            <span className={styles.badge} data-variant="active">
              Active
            </span>
          )}
          <span className={styles.badge} data-variant={roleBadgeVariant(instance.role)}>
            {instance.role}
          </span>
          <span
            className={styles.badge}
            data-variant={instance.writeEnabled ? 'write-enabled' : 'read-only'}
          >
            {instance.writeEnabled ? 'write-enabled' : 'read-only'}
          </span>
        </div>
        <span className={styles.chevron} data-open={open ? 'true' : 'false'}>
          ▾
        </span>
      </div>

      {open && (
        <div className={styles.instanceCardDetails}>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>URL</span>
            <span className={styles.detailValue}>{instance.url}</span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Role</span>
            <span className={styles.detailValue}>{instance.role}</span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Write access</span>
            <span className={styles.detailValue}>
              {instance.writeEnabled ? 'Yes' : 'No'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function SettingsPage() {
  const { instances, activeInstanceName } = usePorts();

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Settings</h1>
        <p className={styles.subheading}>
          Instance configuration is read-only and sourced from environment variables or
          settings.json.
        </p>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionHeading}>Mímir Instances</h2>

        {instances.length === 0 && (
          <p className={styles.noInstances}>No instances configured.</p>
        )}

        <div className={styles.instanceList}>
          {instances.map((instancePorts) => (
            <InstanceCard
              key={instancePorts.instance.name}
              instancePorts={instancePorts}
              isActive={instancePorts.instance.name === activeInstanceName}
            />
          ))}
        </div>

        <p className={styles.configNote}>
          To add or modify instances, update your <code>settings.json</code> or the
          corresponding environment variables and restart the application. Instance
          configuration cannot be changed at runtime.
        </p>
      </div>
    </div>
  );
}

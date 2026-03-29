import { Cpu, Box, Shield, Database, Server, Hammer, Cog, Radio, MapPin, Flag } from 'lucide-react';
import type { Realm } from '@/modules/volundr/models';
import { cn, formatResourcePair } from '@/utils';
import { StatusBadge, StatusDot, ProgressRing } from '@/modules/shared';
import styles from './RealmCard.module.css';

export interface RealmCardProps {
  /** The realm data */
  realm: Realm;
  /** Card variant */
  variant?: 'compact' | 'detailed';
  /** Click handler */
  onClick?: (realm: Realm) => void;
  /** Additional CSS class */
  className?: string;
}

const realmIconMap: Record<string, typeof Cpu> = {
  vanaheim: Shield,
  valhalla: Cpu,
  glitnir: Box,
  jarnvidr: Database,
  eitri: Hammer,
  ymir: Cog,
};

function RealmIcon({ realmId, className }: { realmId: string; className?: string }) {
  const Icon = realmIconMap[realmId] || Server;
  return <Icon className={className} />;
}

function podHealthPercent(realm: Realm): number {
  const pods = realm.resources.pods;
  const total = pods.running + pods.pending + pods.failed + pods.unknown;
  if (total === 0) return 0;
  return Math.round((pods.running / total) * 100);
}

function statusColor(realm: Realm): string {
  if (realm.status === 'healthy') return 'var(--color-accent-emerald)';
  if (realm.status === 'warning') return 'var(--color-accent-amber)';
  if (realm.status === 'critical') return 'var(--color-accent-red)';
  return 'var(--color-text-muted)';
}

export function RealmCard({ realm, variant = 'compact', onClick, className }: RealmCardProps) {
  const isOnline = realm.status !== 'offline';
  const health = podHealthPercent(realm);
  const color = statusColor(realm);
  const pods = realm.resources.pods;
  const totalPods = pods.running + pods.pending + pods.failed + pods.unknown;

  const handleClick = () => {
    if (isOnline && onClick) {
      onClick(realm);
    }
  };

  if (variant === 'detailed') {
    return (
      <div
        className={cn(
          styles.card,
          styles.detailed,
          isOnline && styles.online,
          !isOnline && styles.offline,
          className
        )}
        onClick={handleClick}
      >
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <div className={cn(styles.iconBox, isOnline && styles.iconBoxOnline)}>
              <RealmIcon realmId={realm.id} className={styles.realmIcon} />
            </div>
            <div>
              <h3 className={styles.title}>{realm.name}</h3>
              <p className={styles.location}>{realm.location}</p>
            </div>
          </div>
          <StatusBadge status={realm.status} />
        </div>

        {isOnline && realm.valkyrie ? (
          <>
            <div className={styles.valkyrieSection}>
              <div className={styles.valkyrieHeader}>
                <Radio className={styles.valkyrieIcon} />
                <span className={styles.valkyrieName}>{realm.valkyrie.name}</span>
                <StatusBadge status={realm.valkyrie.status} />
              </div>
              <p className={styles.valkyrieSpecialty}>{realm.valkyrie.specialty}</p>
              <div className={styles.valkyrieStats}>
                <div className={styles.valkyrieStat}>
                  <p className={styles.valkyrieStatValue}>{realm.valkyrie.observationsToday}</p>
                  <p className={styles.valkyrieStatLabel}>observations</p>
                </div>
                <div className={styles.valkyrieStat}>
                  <p className={styles.valkyrieStatValueMono}>{realm.valkyrie.uptime}</p>
                  <p className={styles.valkyrieStatLabel}>uptime</p>
                </div>
              </div>
            </div>

            <div className={styles.resourcesSection}>
              <div className={styles.resourceRow}>
                <span className={styles.resourceLabel}>Pods</span>
                <span className={styles.resourceValue}>
                  {pods.running}/{totalPods} running
                </span>
              </div>
              <div className={styles.progressTrack}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${health}%`, backgroundColor: color }}
                />
              </div>
              {realm.resources.gpuCount > 0 && (
                <div className={styles.resourceRow}>
                  <span className={styles.resourceLabel}>GPUs</span>
                  <span className={styles.resourceValue}>{realm.resources.gpuCount}</span>
                </div>
              )}
              <div className={styles.resourceRow}>
                <span className={styles.resourceLabel}>Memory</span>
                <span className={styles.resourceValue}>
                  {formatResourcePair(
                    realm.resources.memory.allocatable,
                    realm.resources.memory.capacity,
                    realm.resources.memory.unit
                  )}
                </span>
              </div>
            </div>

            {realm.health.reason && (
              <div className={styles.tagsSection}>
                <span className={styles.tag}>{realm.health.reason}</span>
              </div>
            )}
          </>
        ) : (
          <div className={styles.noValkyrieSection}>
            <p className={styles.noValkyrieText}>No Valkyrie deployed</p>
            <button className={styles.deployBtn}>
              <Flag className={styles.deployIcon} />
              Deploy Valkyrie
            </button>
          </div>
        )}
      </div>
    );
  }

  // Compact variant
  return (
    <div
      className={cn(
        styles.card,
        styles.compact,
        isOnline && styles.online,
        !isOnline && styles.offline,
        className
      )}
      onClick={handleClick}
    >
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <div className={cn(styles.iconBoxSmall, isOnline && styles.iconBoxOnline)}>
            <RealmIcon realmId={realm.id} className={styles.realmIconSmall} />
          </div>
          <div>
            <h3 className={styles.title}>{realm.name}</h3>
            <p className={styles.description}>{realm.description}</p>
          </div>
        </div>
        {isOnline ? (
          <ProgressRing value={health} size={44} strokeWidth={4} color={color} />
        ) : (
          <StatusBadge status="offline" />
        )}
      </div>

      {isOnline && realm.valkyrie && (
        <>
          <div className={styles.valkyrieCompact}>
            <div className={styles.valkyrieCompactInfo}>
              <Radio className={styles.valkyrieIconSmall} />
              <span className={styles.valkyrieNameSmall}>{realm.valkyrie.name}</span>
            </div>
            <StatusDot status={realm.valkyrie.status} pulse />
            <span className={styles.separator}>·</span>
            <span className={styles.observationsCount}>{realm.valkyrie.observationsToday} obs</span>
          </div>
          <div className={styles.locationRow}>
            <MapPin className={styles.mapIcon} />
            <span>{realm.location}</span>
          </div>
        </>
      )}

      {!isOnline && (
        <button className={styles.deployBtnCompact}>
          <Flag className={styles.deployIconSmall} />
          Deploy Valkyrie
        </button>
      )}
    </div>
  );
}

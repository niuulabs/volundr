import { Radio, Hammer } from 'lucide-react';
import type { Realm, Einherjar } from '@/modules/volundr/models';
import { Modal, StatusBadge } from '@/modules/shared';
import { cn, formatResourcePair } from '@/utils';
import styles from './RealmDetailModal.module.css';

export interface RealmDetailModalProps {
  /** The realm to display */
  realm: Realm | null;
  /** Einherjar workers in this realm */
  einherjar?: Einherjar[];
  /** Close handler */
  onClose: () => void;
  /** Additional CSS class */
  className?: string;
}

export function RealmDetailModal({
  realm,
  einherjar = [],
  onClose,
  className,
}: RealmDetailModalProps) {
  if (!realm) return null;

  const realmEinherjar = einherjar.filter(e => e.realm === realm.id);
  const pods = realm.resources.pods;
  const totalPods = pods.running + pods.pending + pods.failed + pods.unknown;
  const memPct =
    realm.resources.memory.capacity > 0
      ? (realm.resources.memory.allocatable / realm.resources.memory.capacity) * 100
      : 0;

  return (
    <Modal
      isOpen={!!realm}
      onClose={onClose}
      title={realm.name}
      subtitle={realm.description}
      size="lg"
      className={className}
    >
      <div className={styles.content}>
        <div className={styles.topGrid}>
          {/* Valkyrie Section */}
          {realm.valkyrie && (
            <div className={styles.valkyrieSection}>
              <div className={styles.valkyrieHeader}>
                <div className={styles.valkyrieIconBox}>
                  <Radio className={styles.valkyrieIcon} />
                </div>
                <div>
                  <h3 className={styles.valkyrieName}>{realm.valkyrie.name}</h3>
                  <p className={styles.valkyrieSpecialty}>{realm.valkyrie.specialty}</p>
                </div>
                <StatusBadge status={realm.valkyrie.status} />
              </div>
              <div className={styles.valkyrieStats}>
                <div className={styles.valkyrieStat}>
                  <p className={styles.valkyrieStatValue}>{realm.valkyrie.observationsToday}</p>
                  <p className={styles.valkyrieStatLabel}>observations today</p>
                </div>
                <div className={styles.valkyrieStat}>
                  <p className={cn(styles.valkyrieStatValue, styles.mono)}>
                    {realm.valkyrie.uptime}
                  </p>
                  <p className={styles.valkyrieStatLabel}>uptime</p>
                </div>
              </div>
            </div>
          )}

          {/* Resources Section */}
          <div className={styles.resourcesSection}>
            {/* Pods */}
            <div className={styles.resourceRow}>
              <div className={styles.resourceHeader}>
                <span className={styles.resourceLabel}>Pods</span>
                <span className={styles.resourceValue}>
                  {pods.running}/{totalPods} running
                </span>
              </div>
              <div className={styles.progressTrack}>
                <div
                  className={styles.progressFill}
                  style={{
                    width: `${totalPods > 0 ? (pods.running / totalPods) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>

            {/* Memory */}
            <div className={styles.resourceRow}>
              <div className={styles.resourceHeader}>
                <span className={styles.resourceLabel}>Memory</span>
                <span className={styles.resourceValue}>
                  {formatResourcePair(
                    realm.resources.memory.allocatable,
                    realm.resources.memory.capacity,
                    realm.resources.memory.unit
                  )}
                </span>
              </div>
              <div className={styles.progressTrack}>
                <div className={styles.progressFill} style={{ width: `${memPct}%` }} />
              </div>
            </div>

            {/* CPU */}
            <div className={styles.resourceRow}>
              <div className={styles.resourceHeader}>
                <span className={styles.resourceLabel}>CPU</span>
                <span className={styles.resourceValue}>
                  {realm.resources.cpu.allocatable}/{realm.resources.cpu.capacity}{' '}
                  {realm.resources.cpu.unit}
                </span>
              </div>
            </div>

            {/* GPUs */}
            {realm.resources.gpuCount > 0 && (
              <div className={styles.resourceRow}>
                <div className={styles.resourceHeader}>
                  <span className={styles.resourceLabel}>GPUs</span>
                  <span className={styles.resourceValue}>{realm.resources.gpuCount}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className={styles.bottomGrid}>
          {/* Health info */}
          <div className={styles.poolsCard}>
            <h3 className={styles.cardTitle}>Health</h3>
            <div className={styles.tagsContainer}>
              <span className={styles.tagCyan}>
                {realm.health.inputs.nodesReady}/{realm.health.inputs.nodesTotal} nodes ready
              </span>
              {realm.health.reason && (
                <span className={styles.tagPurple}>{realm.health.reason}</span>
              )}
            </div>
          </div>

          {/* Pod breakdown */}
          <div className={styles.autonomyCard}>
            <h3 className={styles.cardTitle}>Pod Breakdown</h3>
            <div className={styles.autonomyList}>
              <div className={styles.autonomyRow}>
                <span className={styles.autonomyLabel}>Running</span>
                <span className={cn(styles.autonomyValue, styles.autonomyEnabled)}>
                  {pods.running}
                </span>
              </div>
              {pods.pending > 0 && (
                <div className={styles.autonomyRow}>
                  <span className={styles.autonomyLabel}>Pending</span>
                  <span className={cn(styles.autonomyValue, styles.autonomyNotify)}>
                    {pods.pending}
                  </span>
                </div>
              )}
              {pods.failed > 0 && (
                <div className={styles.autonomyRow}>
                  <span className={styles.autonomyLabel}>Failed</span>
                  <span className={cn(styles.autonomyValue, styles.autonomyNever)}>
                    {pods.failed}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Einherjar in this realm */}
        {realmEinherjar.length > 0 && (
          <div className={styles.einherjarSection}>
            <h3 className={styles.cardTitle}>Einherjar in {realm.name}</h3>
            <div className={styles.einherjarList}>
              {realmEinherjar.map(ein => (
                <div key={ein.id} className={styles.einherjarRow}>
                  <div className={styles.einherjarInfo}>
                    <Hammer className={styles.einherjarIcon} />
                    <div>
                      <p className={styles.einherjarName}>{ein.name}</p>
                      <p className={styles.einherjarTask}>{ein.task}</p>
                    </div>
                  </div>
                  <div className={styles.einherjarRight}>
                    {ein.progress !== null && (
                      <div className={styles.einherjarProgress}>
                        <div className={styles.progressTrackSmall}>
                          <div
                            className={styles.progressFillSmall}
                            style={{ width: `${ein.progress}%` }}
                          />
                        </div>
                        <span className={styles.einherjarProgressValue}>{ein.progress}%</span>
                      </div>
                    )}
                    <StatusBadge status={ein.status} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

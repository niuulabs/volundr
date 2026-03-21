import { Eye, AlertTriangle } from 'lucide-react';
import type { OdinState } from '@/modules/volundr/models';
import { cn } from '@/utils';
import { StatusBadge } from '@/modules/shared';
import { CircadianIcon } from '@/modules/volundr/components/atoms/CircadianIcon';
import { ConsciousnessPhaseIndicator } from '@/modules/volundr/components/molecules/ConsciousnessPhaseIndicator';
import styles from './OdinStatusBar.module.css';

export interface OdinStatusBarProps {
  /** The current Odin state */
  state: OdinState;
  /** Whether to show compact variant */
  compact?: boolean;
  /** Callback when a decision is approved */
  onApproveDecision?: (id: string) => void;
  /** Callback when a decision is denied */
  onDenyDecision?: (id: string) => void;
  /** Additional CSS class */
  className?: string;
}

export function OdinStatusBar({
  state,
  compact = false,
  onApproveDecision,
  onDenyDecision,
  className,
}: OdinStatusBarProps) {
  if (compact) {
    return (
      <div className={cn(styles.container, styles.compact, className)}>
        <div className={styles.iconSmall}>
          <Eye />
        </div>
        <div className={styles.contentCompact}>
          <div className={styles.headerCompact}>
            <span className={styles.name}>Odin</span>
            <ConsciousnessPhaseIndicator phase={state.loopPhase} showLabel={false} />
          </div>
          <p className={styles.thoughtCompact}>{state.currentThought}</p>
        </div>
        {state.pendingDecisions.length > 0 && (
          <div className={styles.pendingBadge}>
            <AlertTriangle className={styles.alertIcon} />
            <span>{state.pendingDecisions.length} pending</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn(styles.container, className)}>
      <div className={styles.main}>
        <div className={styles.iconContainer}>
          <div className={styles.icon}>
            <Eye />
          </div>
          <div className={styles.circadianBadge}>
            <CircadianIcon mode={state.circadianMode} size="sm" />
          </div>
        </div>

        <div className={styles.content}>
          <div className={styles.header}>
            <span className={styles.name}>Odin</span>
            <StatusBadge status={state.status} />
            <ConsciousnessPhaseIndicator phase={state.loopPhase} />
            <span className={styles.cycle}>cycle #{state.loopCycle}</span>
          </div>
          <p className={styles.thought}>{state.currentThought}</p>
          <div className={styles.attention}>
            <div className={styles.attentionItem}>
              <span className={styles.attentionLabel}>Focus:</span>
              <span className={styles.attentionPrimary}>{state.attention.primary}</span>
            </div>
            <div className={styles.attentionItem}>
              <span className={styles.attentionLabel}>Also watching:</span>
              <span className={styles.attentionSecondary}>
                {state.attention.secondary.join(', ')}
              </span>
            </div>
          </div>
        </div>

        <div className={styles.resources}>
          <div className={styles.resourceItem}>
            <span className={styles.resourceLabel}>GPUs:</span>
            <span className={styles.resourceValue}>
              {state.resources.idleGPUs}/{state.resources.totalGPUs} idle
            </span>
          </div>
          <div className={styles.resourceItem}>
            <span className={styles.resourceLabel}>Capacity:</span>
            <span className={styles.resourceValueGreen}>
              {state.resources.availableCapacity}% free
            </span>
          </div>
        </div>
      </div>

      {state.pendingDecisions.length > 0 && (
        <div className={styles.decisions}>
          <div className={styles.decisionsHeader}>
            <AlertTriangle className={styles.alertIcon} />
            <span>Pending Decisions ({state.pendingDecisions.length})</span>
          </div>
          <div className={styles.decisionsList}>
            {state.pendingDecisions.map(decision => (
              <div key={decision.id} className={styles.decisionCard}>
                <p className={styles.decisionText}>{decision.description}</p>
                <div className={styles.decisionFooter}>
                  {decision.confidence !== undefined && decision.threshold !== undefined && (
                    <span className={styles.decisionConfidence}>
                      Confidence: {Math.round(decision.confidence * 100)}% (need{' '}
                      {Math.round(decision.threshold * 100)}%)
                    </span>
                  )}
                  <div className={styles.decisionActions}>
                    <button
                      className={styles.approveBtn}
                      onClick={() => onApproveDecision?.(decision.id)}
                    >
                      Approve
                    </button>
                    <button
                      className={styles.denyBtn}
                      onClick={() => onDenyDecision?.(decision.id)}
                    >
                      Deny
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

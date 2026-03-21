import type { CSSProperties } from 'react';
import { GitBranch, Globe, MessageSquare, Zap, Server } from 'lucide-react';
import type { VolundrSession, VolundrModel } from '@/models';
import { StatusBadge } from '@/components/atoms/StatusBadge';
import { TrackerIssueBadge } from '@/components/molecules/TrackerIssueBadge';
import { cn, formatTime, formatTokens } from '@/utils';
import { getSourceLabel, getBranch, isGitSource } from '@/utils/source';
import styles from './SessionCard.module.css';

export interface SessionCardProps {
  /** Session data */
  session: VolundrSession;
  /** Model data for the session's model */
  model?: VolundrModel;
  /** Whether this card is selected */
  selected?: boolean;
  /** Compact single-line view for dense session lists */
  compact?: boolean;
  /** Click handler */
  onClick?: () => void;
  /** Additional CSS class */
  className?: string;
}

export function SessionCard({
  session,
  model,
  selected = false,
  compact = false,
  onClick,
  className,
}: SessionCardProps) {
  const isManual = session.origin === 'manual';
  const isLocal = model?.provider === 'local';
  const lastActiveTime = formatTime(session.lastActive);
  const tokens = formatTokens(session.tokensUsed);

  if (compact) {
    return (
      <div
        className={cn(
          styles.compact,
          styles[session.status],
          selected && styles.selected,
          className
        )}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
      >
        <StatusBadge status={session.status} />
        <span className={styles.compactName}>{session.name}</span>
        <span className={styles.compactStats}>
          <MessageSquare className={styles.statIcon} />
          {session.messageCount}
        </span>
        <span className={styles.compactTime}>{lastActiveTime}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(styles.card, styles[session.status], selected && styles.selected, className)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className={styles.header}>
        <div className={styles.nameGroup}>
          <h3 className={styles.name}>{session.name}</h3>
          {isManual ? (
            <div className={styles.repo}>
              <Globe className={styles.repoIcon} />
              <span>{session.hostname}</span>
            </div>
          ) : (
            <div className={styles.repo}>
              <GitBranch className={styles.repoIcon} />
              <span>{getSourceLabel(session.source)}</span>
              {isGitSource(session.source) && (
                <span className={styles.branch}>{getBranch(session.source)}</span>
              )}
            </div>
          )}
        </div>
        <div className={styles.badges}>
          {session.trackerIssue && <TrackerIssueBadge issue={session.trackerIssue} />}
          {isManual && <span className={styles.manualBadge}>manual</span>}
          <StatusBadge status={session.status} />
        </div>
      </div>

      {!isManual && model && (
        <div
          className={styles.modelBadge}
          style={{ '--model-color': model.color } as CSSProperties}
        >
          {isLocal ? <Zap className={styles.modelIcon} /> : <Server className={styles.modelIcon} />}
          <span>{model.name}</span>
          <span className={styles.modelType}>{isLocal ? 'GPU' : 'API'}</span>
        </div>
      )}

      {session.error && <p className={styles.error}>{session.error}</p>}

      <div className={styles.footer}>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <MessageSquare className={styles.statIcon} />
            <span>{session.messageCount}</span>
          </div>
          <span className={styles.dot}>&middot;</span>
          <span className={styles.stat}>{tokens} tokens</span>
        </div>
        <span className={styles.lastActive}>{lastActiveTime}</span>
      </div>
    </div>
  );
}

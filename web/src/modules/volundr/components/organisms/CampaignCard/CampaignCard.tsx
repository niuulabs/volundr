import { Hammer } from 'lucide-react';
import type { Campaign } from '@/modules/volundr/models';
import { cn } from '@/utils';
import { StatusBadge, StatusDot } from '@/modules/shared';
import styles from './CampaignCard.module.css';

export interface CampaignCardProps {
  /** The campaign data */
  campaign: Campaign;
  /** Click handler */
  onClick?: (campaign: Campaign) => void;
  /** Additional CSS class */
  className?: string;
}

export function CampaignCard({ campaign, onClick, className }: CampaignCardProps) {
  return (
    <div
      className={cn(styles.card, styles[campaign.status], className)}
      onClick={() => onClick?.(campaign)}
    >
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <StatusDot
            status={campaign.status === 'active' ? 'working' : 'idle'}
            pulse={campaign.status === 'active'}
          />
          <h3 className={styles.title}>{campaign.name}</h3>
        </div>
        <StatusBadge status={campaign.status} />
      </div>

      <p className={styles.description}>{campaign.description}</p>

      {campaign.status !== 'queued' && (
        <div className={styles.progressSection}>
          <div className={styles.progressHeader}>
            <span className={styles.progressLabel}>Progress</span>
            <span className={styles.progressValue}>{campaign.progress}%</span>
          </div>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${campaign.progress}%` }} />
          </div>
        </div>
      )}

      <div className={styles.footer}>
        <div className={styles.footerLeft}>
          {campaign.confidence !== null && (
            <span
              className={cn(
                styles.confidence,
                campaign.confidence >= campaign.mergeThreshold
                  ? styles.confidenceHigh
                  : styles.confidenceLow
              )}
            >
              Conf: {Math.round(campaign.confidence * 100)}%
            </span>
          )}
          <span className={styles.eta}>ETA: {campaign.eta}</span>
        </div>
        <div className={styles.workers}>
          <Hammer className={styles.workerIcon} />
          <span>{campaign.einherjar.length}</span>
        </div>
      </div>
    </div>
  );
}

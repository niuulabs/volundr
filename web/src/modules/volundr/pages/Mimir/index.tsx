import { useState } from 'react';
import { Droplet, Database, BarChart3, DollarSign, Clock, ThumbsUp, Sparkles } from 'lucide-react';
import { MetricCard, CollapsibleSection as MythologySection } from '@/modules/shared';
import { ConsultationCard } from '@/modules/volundr/components/organisms/ConsultationCard';
import { useMimir } from '@/modules/volundr/hooks/useMimir';
import type { MimirConsultation } from '@/modules/volundr/models';
import styles from './MimirPage.module.css';

export function MimirPage() {
  const { stats, consultations, loading } = useMimir();
  const [selectedConsultation, setSelectedConsultation] = useState<MimirConsultation | null>(null);

  const usefulCount = consultations.filter(c => c.useful === true).length;
  const usefulPercent =
    consultations.length > 0 ? Math.round((usefulCount / consultations.length) * 100) : 0;

  if (loading || !stats) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>Loading...</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.titleSection}>
          <div className={styles.titleRow}>
            <div className={styles.iconContainer}>
              <Droplet className={styles.icon} />
            </div>
            <div>
              <h1 className={styles.title}>Mímir's Well</h1>
              <p className={styles.subtitle}>
                Deep wisdom from Claude — when ODIN's knowledge is not enough
              </p>
            </div>
          </div>
        </div>
        <div className={styles.modelBadge}>
          <Sparkles className={styles.modelIcon} />
          <span>Claude 3 Opus</span>
        </div>
      </div>

      <div className={styles.metricsRow}>
        <MetricCard
          label="Today"
          value={stats.consultationsToday}
          subtext="consultations"
          icon={Droplet}
          iconColor="indigo"
        />
        <MetricCard
          label="All Time"
          value={stats.totalConsultations}
          subtext="consultations"
          icon={Database}
          iconColor="purple"
        />
        <MetricCard
          label="Tokens Today"
          value={`${(stats.tokensUsedToday / 1000).toFixed(1)}k`}
          subtext="in + out"
          icon={BarChart3}
          iconColor="cyan"
        />
        <MetricCard
          label="Cost Today"
          value={`$${stats.costToday.toFixed(2)}`}
          subtext="estimated"
          icon={DollarSign}
          iconColor="emerald"
        />
        <MetricCard
          label="Avg Latency"
          value={`${stats.avgResponseTime.toFixed(1)}s`}
          subtext="response time"
          icon={Clock}
          iconColor="amber"
        />
        <MetricCard
          label="Usefulness"
          value={`${usefulPercent}%`}
          subtext="marked useful"
          icon={ThumbsUp}
          iconColor="emerald"
        />
      </div>

      <MythologySection
        storageKey="mimir"
        title="The Well of Wisdom"
        icon={Droplet}
        accentColor="indigo"
        description="When ODIN encounters questions beyond his knowledge—complex architectural decisions, unfamiliar technologies, or nuanced judgment calls—he drinks from Mímir's Well. Like the Allfather who sacrificed his eye for wisdom, ODIN pays a cost (API tokens) for deeper understanding."
        footerItems={[
          'Used for: Complex queries, architectural decisions, unfamiliar domains',
          "Avoided for: Simple lookups, things in Muninn's memory",
        ]}
      />

      <div className={styles.content}>
        <div className={styles.consultationsSection}>
          <h2 className={styles.sectionTitle}>Recent Consultations</h2>
          <div className={styles.consultationsList}>
            {consultations.map(consultation => (
              <ConsultationCard
                key={consultation.id}
                consultation={consultation}
                selected={selectedConsultation?.id === consultation.id}
                onClick={() => setSelectedConsultation(consultation)}
              />
            ))}
          </div>
        </div>

        <div className={styles.detailSection}>
          <h2 className={styles.sectionTitle}>Consultation Detail</h2>
          {selectedConsultation ? (
            <div className={styles.detailCard}>
              <div className={styles.detailHeader}>
                <div className={styles.detailIconContainer}>
                  <Sparkles className={styles.detailIcon} />
                </div>
                <div>
                  <h3 className={styles.detailTitle}>{selectedConsultation.topic}</h3>
                  <p className={styles.detailMeta}>
                    Requested by {selectedConsultation.requester} · {selectedConsultation.time}
                  </p>
                </div>
              </div>

              <div className={styles.querySection}>
                <h4 className={styles.queryLabel}>Query</h4>
                <p className={styles.queryText}>{selectedConsultation.query}</p>
              </div>

              <div className={styles.responseSection}>
                <h4 className={styles.responseLabel}>Response</h4>
                <p className={styles.responseText}>{selectedConsultation.response}</p>
              </div>

              <div className={styles.detailFooter}>
                <span className={styles.detailStat}>
                  Tokens: {selectedConsultation.tokensIn + selectedConsultation.tokensOut}
                </span>
                <span className={styles.detailStat}>Latency: {selectedConsultation.latency}s</span>
              </div>
            </div>
          ) : (
            <div className={styles.emptyDetail}>
              <Sparkles className={styles.emptyIcon} />
              <p className={styles.emptyText}>Select a consultation to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

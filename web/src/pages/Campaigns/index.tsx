import { useState } from 'react';
import { Flag, Plus, CheckCircle } from 'lucide-react';
import { CampaignCard, StatusBadge, StatusDot, MythologySection } from '@/components';
import { useCampaigns, useEinherjar } from '@/hooks';
import type { Campaign } from '@/models';
import { cn } from '@/utils';
import styles from './CampaignsPage.module.css';

export function CampaignsPage() {
  const { campaigns, loading } = useCampaigns();
  const { workers } = useEinherjar();
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);

  // Select first campaign if none selected and campaigns are loaded
  const effectiveSelectedCampaign =
    selectedCampaign || (campaigns.length > 0 ? campaigns[0] : null);

  if (loading) {
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
              <Flag className={styles.icon} />
            </div>
            <div>
              <h1 className={styles.title}>Campaigns</h1>
              <p className={styles.subtitle}>Multi-repo coordinated work managed by Tyr</p>
            </div>
          </div>
        </div>
        <button type="button" className={styles.newButton}>
          <Plus className={styles.newButtonIcon} />
          New Campaign
        </button>
      </div>

      <MythologySection
        storageKey="campaigns"
        title="Tyr's Strategic Command"
        icon={Flag}
        accentColor="emerald"
        description="Tyr was the Norse god of war and justice, known for his strategic brilliance and sacrifice. In ODIN, Tyr orchestrates multi-repo campaigns—coordinating phases across repositories, assigning Einherjar to tasks, and ensuring work proceeds in the correct order. Each campaign is a strategic operation spanning multiple codebases."
        footerItems={[
          'Phases: Sequential or parallel work stages',
          'Einherjar: Assigned workers for each phase',
        ]}
      />

      <div className={styles.content}>
        {/* Campaign List */}
        <div className={styles.listSection}>
          {campaigns.map(campaign => (
            <div
              key={campaign.id}
              className={cn(
                styles.campaignCardWrapper,
                effectiveSelectedCampaign?.id === campaign.id && styles.selected
              )}
              onClick={() => setSelectedCampaign(campaign)}
            >
              <CampaignCard campaign={campaign} />
            </div>
          ))}
        </div>

        {/* Detail Panel */}
        {effectiveSelectedCampaign ? (
          <div className={styles.detailPanel}>
            <div className={styles.detailHeader}>
              <div>
                <h2 className={styles.detailTitle}>{effectiveSelectedCampaign.name}</h2>
                <p className={styles.detailDescription}>{effectiveSelectedCampaign.description}</p>
              </div>
              <StatusBadge status={effectiveSelectedCampaign.status} />
            </div>

            {/* Phases */}
            <div className={styles.phasesSection}>
              <h3 className={styles.sectionTitle}>Phases</h3>
              <div className={styles.phasesList}>
                {effectiveSelectedCampaign.phases.map((phase, i) => (
                  <div key={phase.id} className={styles.phaseItem}>
                    <div
                      className={cn(
                        styles.phaseCircle,
                        phase.status === 'complete' && styles.phaseCircleComplete,
                        phase.status === 'active' && styles.phaseCircleActive,
                        phase.status === 'pending' && styles.phaseCirclePending
                      )}
                    >
                      {phase.status === 'complete' ? (
                        <CheckCircle className={styles.phaseCircleIcon} />
                      ) : (
                        i + 1
                      )}
                    </div>
                    <div className={styles.phaseContent}>
                      <div className={styles.phaseHeader}>
                        <span className={styles.phaseName}>{phase.name}</span>
                        <span className={styles.phaseRepo}>{phase.repo}</span>
                        {phase.pr && <span className={styles.phasePr}>PR {phase.pr}</span>}
                      </div>
                      {phase.tasks && (
                        <div className={styles.phaseTasks}>
                          <span className={styles.tasksDone}>{phase.tasks.complete} done</span>
                          <span className={styles.tasksActive}>{phase.tasks.active} active</span>
                          <span className={styles.tasksPending}>{phase.tasks.pending} pending</span>
                        </div>
                      )}
                    </div>
                    <StatusBadge status={phase.status} />
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom Grid */}
            <div className={styles.bottomGrid}>
              {/* Assigned Einherjar */}
              <div className={styles.bottomSection}>
                <h3 className={styles.sectionTitle}>Assigned Einherjar</h3>
                <div className={styles.einherjarList}>
                  {effectiveSelectedCampaign.einherjar.map(id => {
                    const ein = workers.find(e => e.id === id);
                    if (!ein) return null;
                    return (
                      <div key={id} className={styles.einherjarItem}>
                        <StatusDot status={ein.status} pulse={ein.status === 'working'} />
                        <span className={styles.einherjarName}>{ein.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Repository Access */}
              <div className={styles.bottomSection}>
                <h3 className={styles.sectionTitle}>Repository Access</h3>
                <div className={styles.repoTags}>
                  {effectiveSelectedCampaign.repoAccess.map(repo => (
                    <span key={repo} className={styles.repoTag}>
                      {repo}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.emptyDetail}>
            <Flag className={styles.emptyIcon} />
            <p className={styles.emptyText}>Select a campaign to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}

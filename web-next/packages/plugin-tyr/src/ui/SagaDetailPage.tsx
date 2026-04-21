import { useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import {
  StatusBadge,
  ConfidenceBadge,
  LoadingState,
  ErrorState,
  EmptyState,
  Pipe,
  PersonaAvatar,
  Rune,
} from '@niuulabs/ui';
import type { Raid } from '../domain/saga';
import { useSaga } from './useSaga';
import { usePhases } from './usePhases';
import { phaseStatusToCell } from './mappers';
import { WorkflowCard } from './WorkflowCard';
import { StageProgressRail } from './StageProgressRail';
import { ConfidenceDriftCard } from './ConfidenceDriftCard';

interface RaidPanelProps {
  raid: Raid;
  onClose: () => void;
  onOpenSession: (sessionId: string) => void;
}

function RaidPanel({ raid, onClose, onOpenSession }: RaidPanelProps) {
  return (
    <div
      className="niuu-mt-3 niuu-p-4 niuu-rounded-md niuu-bg-bg-elevated niuu-border niuu-border-border niuu-space-y-4"
      role="region"
      aria-label={`Raid detail: ${raid.name}`}
    >
      <div className="niuu-flex niuu-items-center niuu-justify-between">
        <div className="niuu-flex niuu-items-center niuu-gap-2">
          <StatusBadge status={raid.status} />
          <span className="niuu-font-semibold niuu-text-text-primary">{raid.name}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close raid panel"
          className="niuu-text-text-muted hover:niuu-text-text-primary niuu-text-lg niuu-leading-none"
        >
          ×
        </button>
      </div>

      {raid.description && (
        <p className="niuu-m-0 niuu-text-sm niuu-text-text-secondary">{raid.description}</p>
      )}

      {/* Members */}
      <section aria-label="Raid members">
        <h4 className="niuu-text-xs niuu-font-semibold niuu-text-text-muted niuu-uppercase niuu-tracking-wide niuu-mb-2">
          Members
        </h4>
        <div className="niuu-flex niuu-gap-2">
          {raid.sessionId && (
            <PersonaAvatar
              role="build"
              letter={raid.name.charAt(0)}
              size={28}
              title={`Build · ${raid.name}`}
            />
          )}
          {raid.reviewerSessionId && (
            <PersonaAvatar role="review" letter="R" size={28} title="Reviewer" />
          )}
          {!raid.sessionId && !raid.reviewerSessionId && (
            <span className="niuu-text-xs niuu-text-text-muted">No members assigned</span>
          )}
        </div>
      </section>

      {/* Events / Chronicle */}
      {raid.chronicleSummary && (
        <section aria-label="Raid events">
          <h4 className="niuu-text-xs niuu-font-semibold niuu-text-text-muted niuu-uppercase niuu-tracking-wide niuu-mb-2">
            Events
          </h4>
          <p className="niuu-m-0 niuu-text-sm niuu-text-text-secondary niuu-font-mono">
            {raid.chronicleSummary}
          </p>
        </section>
      )}

      {/* Artefacts */}
      {raid.declaredFiles.length > 0 && (
        <section aria-label="Raid artefacts">
          <h4 className="niuu-text-xs niuu-font-semibold niuu-text-text-muted niuu-uppercase niuu-tracking-wide niuu-mb-2">
            Artefacts
          </h4>
          <ul className="niuu-list-none niuu-p-0 niuu-m-0 niuu-space-y-1">
            {raid.declaredFiles.map((file) => (
              <li key={file} className="niuu-text-xs niuu-font-mono niuu-text-text-secondary">
                {file}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Open session link */}
      {raid.sessionId && (
        <div className="niuu-pt-2">
          <button
            type="button"
            className="niuu-px-4 niuu-py-2 niuu-rounded-md niuu-bg-brand niuu-text-bg-primary niuu-text-sm niuu-font-medium niuu-cursor-pointer"
            onClick={() => onOpenSession(raid.sessionId!)}
            aria-label={`Open Völundr session for ${raid.name}`}
          >
            Open session →
          </button>
        </div>
      )}
    </div>
  );
}

interface SagaDetailPageProps {
  sagaId: string;
  /** Hide the "← Sagas" back button (used when embedded in a split-panel). */
  hideBackButton?: boolean;
}

export function SagaDetailPage({ sagaId, hideBackButton = false }: SagaDetailPageProps) {
  const navigate = useNavigate();
  const [expandedRaidId, setExpandedRaidId] = useState<string | null>(null);

  const {
    data: saga,
    isLoading: sagaLoading,
    isError: sagaError,
    error: sagaErr,
  } = useSaga(sagaId);
  const {
    data: phases,
    isLoading: phasesLoading,
    isError: phasesError,
    error: phasesErr,
  } = usePhases(sagaId);

  function handleOpenSession(sessionId: string) {
    void navigate({ to: '/volundr/session/$sessionId', params: { sessionId } });
  }

  if (sagaLoading || phasesLoading) return <LoadingState label="Loading saga…" />;
  if (sagaError)
    return (
      <ErrorState message={sagaErr instanceof Error ? sagaErr.message : 'Failed to load saga'} />
    );
  if (phasesError)
    return (
      <ErrorState
        message={phasesErr instanceof Error ? phasesErr.message : 'Failed to load phases'}
      />
    );
  if (!saga) return <ErrorState message={`Saga "${sagaId}" not found`} />;

  const allPhases = phases ?? [];

  return (
    <div className="niuu-p-6">
      {/* Back navigation */}
      {!hideBackButton && (
        <button
          type="button"
          onClick={() => void navigate({ to: '/tyr/sagas' })}
          className="niuu-text-sm niuu-text-text-secondary hover:niuu-text-text-primary niuu-flex niuu-items-center niuu-gap-1 niuu-mb-6"
          aria-label="Back to sagas"
        >
          ← Sagas
        </button>
      )}

      {/* 2-column layout: content left, cards right */}
      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '24px', alignItems: 'start' }}
      >
        {/* ── Left column: header + phases ─── */}
        <div className="niuu-space-y-6">
          {/* Saga header */}
          <header className="niuu-space-y-3">
            <div className="niuu-flex niuu-items-center niuu-gap-3">
              <Rune glyph="ᚦ" size={28} />
              <h2 className="niuu-m-0 niuu-text-xl niuu-font-semibold niuu-text-text-primary">
                {saga.name}
              </h2>
              <StatusBadge status={saga.status} />
              <ConfidenceBadge value={saga.confidence / 100} />
            </div>
            <p className="niuu-m-0 niuu-text-sm niuu-text-text-muted">
              {saga.trackerId} · {saga.featureBranch} · Created{' '}
              {new Date(saga.createdAt).toLocaleDateString()}
            </p>

            {/* Phase pipeline */}
            {allPhases.length > 0 && (
              <Pipe
                cells={allPhases.map((p) => ({
                  status: phaseStatusToCell(p.status),
                  label: p.name,
                }))}
              />
            )}
          </header>

          {/* Phases and raids */}
          {allPhases.length === 0 ? (
            <EmptyState
              title="No phases yet"
              description="This saga has not been decomposed into phases."
            />
          ) : (
            <div className="niuu-space-y-6">
              {allPhases.map((phase) => (
                <section key={phase.id} aria-label={`Phase ${phase.number}: ${phase.name}`}>
                  <div className="niuu-flex niuu-items-center niuu-gap-3 niuu-mb-3">
                    <span className="niuu-text-xs niuu-font-mono niuu-text-text-muted">
                      Phase {phase.number}
                    </span>
                    <h3 className="niuu-m-0 niuu-text-base niuu-font-semibold niuu-text-text-primary">
                      {phase.name}
                    </h3>
                    <StatusBadge status={phase.status} />
                    <ConfidenceBadge value={phase.confidence / 100} />
                  </div>

                  {phase.raids.length === 0 ? (
                    <p className="niuu-text-sm niuu-text-text-muted">No raids in this phase.</p>
                  ) : (
                    <ul className="niuu-list-none niuu-p-0 niuu-m-0 niuu-space-y-2">
                      {phase.raids.map((raid) => (
                        <li key={raid.id}>
                          <button
                            type="button"
                            className="niuu-w-full niuu-text-left niuu-p-3 niuu-rounded-md niuu-bg-bg-secondary niuu-border niuu-border-border niuu-cursor-pointer"
                            onClick={() =>
                              setExpandedRaidId(expandedRaidId === raid.id ? null : raid.id)
                            }
                            aria-expanded={expandedRaidId === raid.id}
                            aria-controls={`raid-panel-${raid.id}`}
                            aria-label={`${expandedRaidId === raid.id ? 'Collapse' : 'Expand'} raid ${raid.name}`}
                          >
                            <div className="niuu-flex niuu-items-center niuu-justify-between niuu-gap-3">
                              <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-min-w-0">
                                <StatusBadge status={raid.status} />
                                <span className="niuu-text-sm niuu-font-medium niuu-text-text-primary niuu-truncate">
                                  {raid.name}
                                </span>
                              </div>
                              <div className="niuu-flex niuu-items-center niuu-gap-3 niuu-flex-shrink-0">
                                {/* Member avatars */}
                                <div className="niuu-flex niuu-gap-1">
                                  {raid.sessionId && (
                                    <PersonaAvatar
                                      role="build"
                                      letter={raid.name.charAt(0)}
                                      size={22}
                                    />
                                  )}
                                  {raid.reviewerSessionId && (
                                    <PersonaAvatar role="review" letter="R" size={22} />
                                  )}
                                </div>
                                <ConfidenceBadge value={raid.confidence / 100} />
                              </div>
                            </div>
                          </button>

                          {expandedRaidId === raid.id && (
                            <div id={`raid-panel-${raid.id}`}>
                              <RaidPanel
                                raid={raid}
                                onClose={() => setExpandedRaidId(null)}
                                onOpenSession={handleOpenSession}
                              />
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>

        {/* ── Right column: workflow / progress / confidence cards ─── */}
        <div className="niuu-space-y-4">
          <WorkflowCard workflow={saga.workflow} workflowVersion={saga.workflowVersion} />
          <StageProgressRail phases={allPhases} />
          <ConfidenceDriftCard sagaId={saga.id} confidence={saga.confidence} />
        </div>
      </div>
    </div>
  );
}

export function SagaDetailRoute() {
  const { sagaId } = useParams({ strict: false }) as { sagaId: string };
  return <SagaDetailPage sagaId={sagaId} />;
}

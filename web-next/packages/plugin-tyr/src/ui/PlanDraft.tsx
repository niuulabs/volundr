import { useState } from 'react';
import { ConfidenceBar, type ConfidenceLevel } from '@niuulabs/ui';
import type { ExtractedStructure, PhaseSpec } from '../ports';

function toLevel(value: number): ConfidenceLevel {
  if (value >= 80) return 'high';
  if (value >= 50) return 'medium';
  return 'low';
}

interface PlanDraftProps {
  structure: ExtractedStructure;
  loading: boolean;
  error: string | null;
  onApprove(): void;
  onBack(): void;
  onEditPhase(phaseIndex: number, name: string): void;
}

interface PhaseEditorProps {
  phase: PhaseSpec;
  phaseIndex: number;
  onSave(name: string): void;
}

function PhaseEditor({ phase, phaseIndex, onSave }: PhaseEditorProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(phase.name);

  function handleSave() {
    onSave(name);
    setEditing(false);
  }

  function handleCancel() {
    setName(phase.name);
    setEditing(false);
  }

  const avgConfidence =
    phase.raids.length > 0
      ? Math.round(phase.raids.reduce((sum, r) => sum + r.confidence, 0) / phase.raids.length)
      : 0;

  return (
    <div
      className="niuu-rounded-lg niuu-border niuu-border-border niuu-bg-bg-secondary niuu-p-4 niuu-flex niuu-flex-col niuu-gap-3"
      data-testid={`phase-${phaseIndex}`}
    >
      <div className="niuu-flex niuu-items-start niuu-justify-between niuu-gap-2">
        {editing ? (
          <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-flex-1">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label={`Edit phase ${phaseIndex + 1} name`}
              className="niuu-flex-1 niuu-rounded niuu-border niuu-border-border niuu-bg-bg-tertiary niuu-px-2 niuu-py-1 niuu-text-sm niuu-text-text-primary focus:niuu-outline-none focus:niuu-ring-2 focus:niuu-ring-brand-500/40"
              autoFocus
            />
            <button
              type="button"
              onClick={handleSave}
              className="niuu-text-xs niuu-font-medium niuu-text-brand-400 hover:niuu-text-brand-300"
            >
              Save
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="niuu-text-xs niuu-text-text-muted hover:niuu-text-text-secondary"
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <div className="niuu-flex niuu-flex-col niuu-gap-1 niuu-flex-1 niuu-min-w-0">
              <h3 className="niuu-text-sm niuu-font-semibold niuu-text-text-primary niuu-truncate">
                {phase.name}
              </h3>
              {phase.raids.length > 0 && (
                <div className="niuu-flex niuu-items-center niuu-gap-2">
                  <ConfidenceBar level={toLevel(avgConfidence)} />
                  <span className="niuu-text-xs niuu-text-text-muted">
                    {phase.raids.length} raid{phase.raids.length !== 1 ? 's' : ''}
                  </span>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label={`Edit phase ${phaseIndex + 1}`}
              className="niuu-flex-shrink-0 niuu-text-xs niuu-font-medium niuu-text-text-muted hover:niuu-text-text-secondary niuu-border niuu-border-border niuu-rounded niuu-px-2 niuu-py-1 niuu-transition-colors"
            >
              Edit
            </button>
          </>
        )}
      </div>

      {phase.raids.length > 0 && (
        <ul className="niuu-flex niuu-flex-col niuu-gap-2 niuu-list-none niuu-p-0 niuu-m-0">
          {phase.raids.map((raid, ri) => (
            <li
              key={ri}
              className="niuu-rounded niuu-bg-bg-tertiary niuu-px-3 niuu-py-2 niuu-flex niuu-flex-col niuu-gap-0.5"
            >
              <span className="niuu-text-xs niuu-font-medium niuu-text-text-primary">
                {raid.name}
              </span>
              {raid.description && (
                <span className="niuu-text-xs niuu-text-text-muted">{raid.description}</span>
              )}
              <span className="niuu-text-xs niuu-text-text-muted">
                ~{raid.estimateHours}h · {raid.confidence}% confidence
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Step 4 of the Plan wizard — review the decomposed saga structure with
 * per-phase edit buttons before approving.
 */
export function PlanDraft({
  structure,
  loading,
  error,
  onApprove,
  onBack,
  onEditPhase,
}: PlanDraftProps) {
  const phases = structure.structure?.phases ?? [];
  const sagaName = structure.structure?.name ?? 'New Saga';

  const totalRaids = phases.reduce((sum, p) => sum + p.raids.length, 0);
  const avgConfidence =
    totalRaids > 0
      ? Math.round(
          phases.flatMap((p) => p.raids).reduce((sum, r) => sum + r.confidence, 0) / totalRaids,
        )
      : 0;

  return (
    <div className="niuu-flex niuu-flex-col niuu-gap-4">
      <div className="niuu-flex niuu-flex-col niuu-gap-1">
        <h2 className="niuu-text-lg niuu-font-semibold niuu-text-text-primary">Review your plan</h2>
        <p className="niuu-text-sm niuu-text-text-secondary">
          The planning raven decomposed your goal. Edit any phase, then approve to create the saga.
        </p>
      </div>

      <div className="niuu-rounded-lg niuu-border niuu-border-border niuu-bg-bg-elevated niuu-px-4 niuu-py-3 niuu-flex niuu-items-center niuu-justify-between">
        <div className="niuu-flex niuu-flex-col">
          <span className="niuu-text-sm niuu-font-semibold niuu-text-text-primary">{sagaName}</span>
          <span className="niuu-text-xs niuu-text-text-muted">
            {phases.length} phase{phases.length !== 1 ? 's' : ''} · {totalRaids} raid
            {totalRaids !== 1 ? 's' : ''}
          </span>
        </div>
        {totalRaids > 0 && (
          <div className="niuu-flex niuu-items-center niuu-gap-2">
            <ConfidenceBar level={toLevel(avgConfidence)} />
            <span className="niuu-text-xs niuu-text-text-secondary">{avgConfidence}%</span>
          </div>
        )}
      </div>

      {phases.length === 0 && (
        <p className="niuu-text-sm niuu-text-text-muted niuu-italic">
          No phases extracted — the raven couldn&apos;t decompose this goal. Try going back and
          adding more context.
        </p>
      )}

      <div className="niuu-flex niuu-flex-col niuu-gap-3">
        {phases.map((phase, idx) => (
          <PhaseEditor
            key={idx}
            phase={phase}
            phaseIndex={idx}
            onSave={(name) => onEditPhase(idx, name)}
          />
        ))}
      </div>

      {error && (
        <p role="alert" className="niuu-text-sm niuu-text-critical">
          {error}
        </p>
      )}

      <div className="niuu-flex niuu-justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={loading}
          className="niuu-rounded-md niuu-px-4 niuu-py-2 niuu-text-sm niuu-font-medium niuu-text-text-secondary niuu-border niuu-border-border hover:niuu-bg-bg-elevated disabled:niuu-opacity-40 niuu-transition-colors"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onApprove}
          disabled={loading || phases.length === 0}
          className="niuu-rounded-md niuu-bg-brand-500 niuu-px-4 niuu-py-2 niuu-text-sm niuu-font-medium niuu-text-white disabled:niuu-opacity-40 disabled:niuu-cursor-not-allowed hover:niuu-bg-brand-600 niuu-transition-colors"
        >
          {loading ? 'Launching…' : 'Approve & launch →'}
        </button>
      </div>
    </div>
  );
}

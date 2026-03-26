import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { tyrService } from '../../adapters';
import { SessionChat } from '@/modules/shared/components/SessionChat';
import { useSkuldChat } from '@/modules/shared/hooks/useSkuldChat';
import type { CommitSagaRequest } from '../../ports/tyr.port';
import styles from './PlanSagaView.module.css';

interface DetectedStructure {
  name: string;
  phases: {
    name: string;
    raids: {
      name: string;
      description: string;
      acceptance_criteria: string[];
      declared_files: string[];
      estimate_hours: number;
    }[];
  }[];
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/** Try to extract a SagaStructure JSON from assistant message text. */
function tryDetectStructure(text: string): DetectedStructure | null {
  const fenceRe = /```(?:json)?\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(text)) !== null) {
    try {
      const data = JSON.parse(match[1].trim());
      if (data && typeof data === 'object' && Array.isArray(data.phases) && data.name) {
        return data as DetectedStructure;
      }
    } catch {
      // not valid JSON
    }
  }
  return null;
}

export function PlanSagaView() {
  const [spec, setSpec] = useState('');
  const [repo, setRepo] = useState('');
  const [chatEndpoint, setChatEndpoint] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [spawning, setSpawning] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectedStructure, setDetectedStructure] = useState<DetectedStructure | null>(null);
  const navigate = useNavigate();

  const skuld = useSkuldChat(chatEndpoint);

  // Auto-detect structure in new assistant messages
  useEffect(() => {
    if (skuld.messages.length === 0) return;
    const lastMsg = skuld.messages[skuld.messages.length - 1];
    if (lastMsg.role !== 'assistant' || lastMsg.status !== 'complete') return;

    const found = tryDetectStructure(lastMsg.content);
    if (found) {
      setDetectedStructure(found);
    }
  }, [skuld.messages]);

  const handleSpawn = async () => {
    setSpawning(true);
    setError(null);
    try {
      const session = await tyrService.spawnPlanSession(spec, repo);
      setSessionId(session.session_id);
      setChatEndpoint(session.chat_endpoint);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to spawn planning session');
    } finally {
      setSpawning(false);
    }
  };

  const handleCommit = async () => {
    if (!detectedStructure) return;
    setCommitting(true);
    setError(null);
    try {
      const commitRequest: CommitSagaRequest = {
        name: detectedStructure.name,
        slug: slugify(detectedStructure.name),
        repos: [repo],
        base_branch: 'main',
        phases: detectedStructure.phases.map(phase => ({
          name: phase.name,
          raids: phase.raids.map(raid => ({
            name: raid.name,
            description: raid.description,
            acceptance_criteria: raid.acceptance_criteria,
            declared_files: raid.declared_files,
            estimate_hours: raid.estimate_hours,
          })),
        })),
      };
      const saga = await tyrService.commitSaga(commitRequest);
      navigate(`/tyr/sagas/${saga.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to commit saga');
    } finally {
      setCommitting(false);
    }
  };

  const handleFallbackDecompose = async () => {
    setSpawning(true);
    setError(null);
    try {
      const phases = await tyrService.decompose(spec, repo);
      if (phases.length > 0) {
        navigate('/tyr/new', { state: { phases, spec, repo } });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fallback decomposition failed');
    } finally {
      setSpawning(false);
    }
  };

  // Memoize whether we have an active session to avoid unnecessary re-renders
  const hasSession = useMemo(() => sessionId !== null, [sessionId]);

  return (
    <div className={styles.container}>
      <h2 className={styles.heading}>Plan Saga</h2>

      {error && <div className={styles.error}>{error}</div>}

      {!hasSession && (
        <div className={styles.form}>
          <label className={styles.label} htmlFor="plan-spec">
            Specification
          </label>
          <textarea
            id="plan-spec"
            className={styles.textarea}
            value={spec}
            onChange={e => setSpec(e.target.value)}
            placeholder="Describe the feature to decompose..."
            rows={8}
          />

          <label className={styles.label} htmlFor="plan-repo">
            Repository
          </label>
          <input
            id="plan-repo"
            type="text"
            className={styles.input}
            value={repo}
            onChange={e => setRepo(e.target.value)}
            placeholder="org/repo"
          />

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={handleFallbackDecompose}
              disabled={!spec.trim() || !repo.trim() || spawning}
            >
              One-shot Decompose
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleSpawn}
              disabled={!spec.trim() || !repo.trim() || spawning}
            >
              {spawning ? 'Starting...' : 'Start Planning Session'}
            </button>
          </div>
        </div>
      )}

      {hasSession && (
        <div className={styles.sessionArea}>
          <div className={styles.sessionHeader}>
            <span className={styles.sessionStatus} data-status="ACTIVE">
              ACTIVE
            </span>
            <span className={styles.sessionRepo}>{repo}</span>
          </div>

          <SessionChat url={chatEndpoint} chatEndpoint={chatEndpoint} />

          {detectedStructure && (
            <div className={styles.detectedStructure}>
              <span className={styles.detectedLabel}>
                Structure detected: {detectedStructure.name} ({detectedStructure.phases.length}{' '}
                phases)
              </span>
              <div className={styles.structurePreview}>
                <h3 className={styles.previewHeading}>Proposed Structure</h3>
                <div className={styles.structureName}>{detectedStructure.name}</div>
                {detectedStructure.phases.map((phase, pi) => (
                  <div key={pi} className={styles.phase}>
                    <div className={styles.phaseName}>{phase.name}</div>
                    {phase.raids.map((raid, ri) => (
                      <div key={ri} className={styles.raid}>
                        <span className={styles.raidName}>{raid.name}</span>
                        <span className={styles.raidEstimate}>{raid.estimate_hours}h</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.commitButton}
                  onClick={handleCommit}
                  disabled={committing}
                >
                  {committing ? 'Committing...' : 'Commit Saga'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

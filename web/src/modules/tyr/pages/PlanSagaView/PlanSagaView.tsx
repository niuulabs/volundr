import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { planningService, tyrService } from '../../adapters';
import { ChatPanel } from '../../components/ChatPanel';
import type { PlanningSession, PlanningMessage } from '../../models/planning';
import styles from './PlanSagaView.module.css';

export function PlanSagaView() {
  const [spec, setSpec] = useState('');
  const [repo, setRepo] = useState('');
  const [session, setSession] = useState<PlanningSession | null>(null);
  const [messages, setMessages] = useState<PlanningMessage[]>([]);
  const [spawning, setSpawning] = useState(false);
  const [structureJson, setStructureJson] = useState('');
  const [proposing, setProposing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleSpawn = async () => {
    setSpawning(true);
    setError(null);
    try {
      const s = await planningService.spawnSession(spec, repo);
      setSession(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to spawn planning session');
    } finally {
      setSpawning(false);
    }
  };

  const handleSendMessage = useCallback(
    async (content: string) => {
      if (!session) return;
      try {
        const msg = await planningService.sendMessage(session.id, content);
        setMessages(prev => [...prev, msg]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to send message');
      }
    },
    [session],
  );

  const handleProposeStructure = async () => {
    if (!session) return;
    setProposing(true);
    setError(null);
    try {
      const updated = await planningService.proposeStructure(session.id, structureJson);
      setSession(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid saga structure');
    } finally {
      setProposing(false);
    }
  };

  const handleCommit = async () => {
    if (!session?.structure) return;
    setCommitting(true);
    setError(null);
    try {
      await planningService.completeSession(session.id);
      const saga = await tyrService.createSaga(spec, repo);
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
        navigate('/tyr/new');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fallback decomposition failed');
    } finally {
      setSpawning(false);
    }
  };

  const isActive = session?.status === 'ACTIVE' || session?.status === 'STRUCTURE_PROPOSED';

  return (
    <div className={styles.container}>
      <h2 className={styles.heading}>Plan Saga</h2>

      {error && <div className={styles.error}>{error}</div>}

      {!session && (
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

      {session && (
        <div className={styles.sessionArea}>
          <div className={styles.sessionHeader}>
            <span className={styles.sessionStatus} data-status={session.status}>
              {session.status}
            </span>
            <span className={styles.sessionRepo}>{session.repo}</span>
          </div>

          <ChatPanel
            messages={messages}
            onSend={handleSendMessage}
            disabled={!isActive}
          />

          {isActive && (
            <div className={styles.structureArea}>
              <label className={styles.label} htmlFor="structure-json">
                Paste saga structure JSON
              </label>
              <textarea
                id="structure-json"
                className={styles.textarea}
                value={structureJson}
                onChange={e => setStructureJson(e.target.value)}
                placeholder='{"name": "...", "phases": [...]}'
                rows={6}
              />
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={handleProposeStructure}
                  disabled={!structureJson.trim() || proposing}
                >
                  {proposing ? 'Validating...' : 'Propose Structure'}
                </button>
              </div>
            </div>
          )}

          {session.structure && (
            <div className={styles.structurePreview}>
              <h3 className={styles.previewHeading}>Proposed Structure</h3>
              <div className={styles.structureName}>{session.structure.name}</div>
              {session.structure.phases.map((phase, pi) => (
                <div key={pi} className={styles.phase}>
                  <div className={styles.phaseName}>{phase.name}</div>
                  {phase.raids.map((raid, ri) => (
                    <div key={ri} className={styles.raid}>
                      <span className={styles.raidName}>{raid.name}</span>
                      <span className={styles.raidEstimate}>
                        {raid.estimate_hours}h
                      </span>
                    </div>
                  ))}
                </div>
              ))}
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

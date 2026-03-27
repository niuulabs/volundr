import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { tyrService } from '../../adapters';
import { SessionChat } from '@/modules/shared/components/SessionChat';
import { useSkuldChat } from '@/modules/shared/hooks/useSkuldChat';
import { RepoSelector } from '../../components/RepoSelector';
import { useRepos } from '../../hooks';
import type { CommitSagaRequest, ExtractedStructure } from '../../ports/tyr.port';
import type { VolundrSession } from '@/modules/volundr/models';
import { createApiClient } from '@/modules/shared/api/client';
import styles from './PlanSagaView.module.css';

const volundrApi = createApiClient('/api/v1/volundr');

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

export function PlanSagaView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSessionId = searchParams.get('session');

  const [sessions, setSessions] = useState<VolundrSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [spec, setSpec] = useState('');
  const [repo, setRepo] = useState('');
  const [spawning, setSpawning] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectedStructure, setDetectedStructure] = useState<DetectedStructure | null>(null);
  const lastCheckedMsgId = useRef<string | null>(null);
  const navigate = useNavigate();

  const { repos: availableRepos, loading: reposLoading } = useRepos();

  // Fetch planning sessions
  useEffect(() => {
    let cancelled = false;
    volundrApi
      .get<VolundrSession[]>('/sessions')
      .then(all => {
        if (cancelled) return;
        const planners = all.filter(
          (s: VolundrSession) => s.taskType === 'planner' || s.name?.startsWith('plan-')
        );
        setSessions(planners);

        // If no active session selected and we have sessions, select the most recent
        if (!activeSessionId && planners.length > 0) {
          setSearchParams({ session: planners[0].id }, { replace: true });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, setSearchParams]);

  // Resolve chat endpoint for active session
  const activeSession = sessions.find(s => s.id === activeSessionId);
  const chatEndpoint = activeSession?.chatEndpoint ?? null;

  const skuld = useSkuldChat(chatEndpoint);

  // Auto-detect structure when assistant completes a message
  useEffect(() => {
    if (skuld.messages.length === 0) return;
    const lastMsg = skuld.messages[skuld.messages.length - 1];
    if (lastMsg.role !== 'assistant' || lastMsg.status !== 'complete') return;
    if (lastMsg.id === lastCheckedMsgId.current) return;
    lastCheckedMsgId.current = lastMsg.id;

    tyrService
      .extractStructure(lastMsg.content)
      .then((result: ExtractedStructure) => {
        if (result.found) {
          setDetectedStructure(result.structure as DetectedStructure);
        }
      })
      .catch(() => {});
  }, [skuld.messages]);

  const repoDisplayName = useMemo(() => {
    if (!repo) return '';
    const r = availableRepos.find(r => r.url === repo);
    return r ? `${r.org}/${r.name}` : repo;
  }, [repo, availableRepos]);

  const handleSpawn = useCallback(async () => {
    setSpawning(true);
    setError(null);
    try {
      const result = await tyrService.spawnPlanSession(spec, repo || repoDisplayName);
      setShowForm(false);
      setSearchParams({ session: result.session_id }, { replace: true });

      // Refresh session list
      const all = await volundrApi.get<VolundrSession[]>('/sessions');
      setSessions(
        all.filter((s: VolundrSession) => s.taskType === 'planner' || s.name?.startsWith('plan-'))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start planning session');
    } finally {
      setSpawning(false);
    }
  }, [spec, repo, repoDisplayName, setSearchParams]);

  const handleCommit = useCallback(async () => {
    if (!detectedStructure) return;
    setCommitting(true);
    setError(null);
    try {
      const commitRequest: CommitSagaRequest = {
        name: detectedStructure.name,
        slug: slugify(detectedStructure.name),
        repos: [repo || repoDisplayName],
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
  }, [detectedStructure, repo, repoDisplayName, navigate]);

  const selectSession = useCallback(
    (id: string) => {
      setSearchParams({ session: id }, { replace: true });
      setDetectedStructure(null);
    },
    [setSearchParams]
  );

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <h2 className={styles.heading}>Planning</h2>
        <button type="button" className={styles.newButton} onClick={() => setShowForm(true)}>
          <Plus className={styles.newButtonIcon} />
          New Session
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {/* Body: session list + chat */}
      <div className={styles.body}>
        {/* Session list */}
        <div className={styles.sessionList}>
          {sessionsLoading && <div className={styles.emptyList}>Loading...</div>}
          {!sessionsLoading && sessions.length === 0 && (
            <div className={styles.emptyList}>No planning sessions yet</div>
          )}
          {sessions.map(s => (
            <div
              key={s.id}
              className={styles.sessionCard}
              data-active={s.id === activeSessionId ? 'true' : undefined}
              onClick={() => selectSession(s.id)}
            >
              <span className={styles.sessionCardName}>{s.name}</span>
              <div className={styles.sessionCardMeta}>
                <span className={styles.sessionCardStatus} data-status={s.status}>
                  {s.status}
                </span>
                <span>{s.model}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Chat area */}
        <div className={styles.chatArea}>
          {activeSession ? (
            <>
              <div className={styles.chatHeader}>
                <div className={styles.chatHeaderLeft}>
                  <span className={styles.chatStatus} data-status="active">
                    {activeSession.status}
                  </span>
                  <span className={styles.chatRepo}>{activeSession.name}</span>
                </div>
              </div>
              <div className={styles.chatBody}>
                <SessionChat url={chatEndpoint} chatEndpoint={chatEndpoint} />
              </div>
              {detectedStructure && (
                <div className={styles.structureBanner}>
                  <div className={styles.structureInfo}>
                    <span className={styles.structureLabel}>
                      Structure detected: {detectedStructure.name}
                    </span>
                    <span className={styles.structureDetail}>
                      {detectedStructure.phases.length} phases,{' '}
                      {detectedStructure.phases.reduce((n, p) => n + p.raids.length, 0)} raids
                    </span>
                  </div>
                  <button
                    type="button"
                    className={styles.commitButton}
                    onClick={handleCommit}
                    disabled={committing}
                  >
                    {committing ? 'Creating...' : 'Create Saga'}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className={styles.emptyChat}>
              {sessions.length > 0
                ? 'Select a planning session'
                : 'Start a new planning session to begin'}
            </div>
          )}
        </div>
      </div>

      {/* New session form overlay */}
      {showForm && (
        <div className={styles.formOverlay}>
          <div className={styles.formPanel}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle}>New Planning Session</span>
              <button type="button" className={styles.formClose} onClick={() => setShowForm(false)}>
                {'\u2715'}
              </button>
            </div>
            <div className={styles.formBody}>
              <div className={styles.formField}>
                <label className={styles.formLabel}>What do you want to build?</label>
                <textarea
                  className={styles.textarea}
                  value={spec}
                  onChange={e => setSpec(e.target.value)}
                  placeholder="Describe the feature, epic, or project to decompose into a saga..."
                  rows={6}
                />
              </div>
              <div className={styles.formField}>
                <label className={styles.formLabel}>Repository</label>
                {!reposLoading && availableRepos.length > 0 ? (
                  <RepoSelector
                    mode="single"
                    repos={availableRepos}
                    value={repo}
                    onSelect={setRepo}
                    showBranch={false}
                  />
                ) : (
                  <input
                    type="text"
                    className={styles.textarea}
                    value={repo}
                    onChange={e => setRepo(e.target.value)}
                    placeholder={reposLoading ? 'Loading repos...' : 'org/repo'}
                    disabled={reposLoading}
                    style={{ resize: 'none', minHeight: 'auto' }}
                  />
                )}
              </div>
            </div>
            <div className={styles.formFooter}>
              <button
                type="button"
                className={styles.cancelButton}
                onClick={() => setShowForm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.startButton}
                disabled={!spec.trim() || spawning}
                onClick={handleSpawn}
              >
                {spawning ? 'Starting...' : 'Start Planning'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

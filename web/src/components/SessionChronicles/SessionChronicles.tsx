import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import {
  MessageSquare,
  FileText,
  GitCommit,
  Terminal,
  AlertCircle,
  Hammer,
  History,
  GitPullRequest,
  GitMerge,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
} from 'lucide-react';
import type {
  VolundrSession,
  SessionChronicle,
  ChronicleEventType,
  SessionStatus,
  PullRequest,
  CIStatusValue,
  TrackerIssue,
  TrackerIssueStatus,
} from '@/models';
import { TrackerIssueSection } from '@/components/molecules/TrackerIssueSection';
import { ContextSidebar } from '@/components/ContextSidebar';
import { useContextSidebar } from '@/hooks';
import { cn } from '@/utils';
import styles from './SessionChronicles.module.css';

export interface SessionChroniclesProps {
  session?: VolundrSession | null;
  sessionId: string;
  sessionStatus: SessionStatus;
  chronicle: SessionChronicle | null;
  loading: boolean;
  onFetch: (sessionId: string) => Promise<void>;
  className?: string;
  repoUrl: string;
  branch: string;
  pullRequest: PullRequest | null;
  prLoading: boolean;
  prCreating: boolean;
  prMerging: boolean;
  onFetchPR: (repoUrl: string, branch: string) => Promise<void>;
  onCreatePR: (sessionId: string, title?: string, targetBranch?: string) => Promise<void>;
  onMergePR: (prNumber: number, repoUrl: string) => Promise<void>;
  onRefreshCI: (prNumber: number, repoUrl: string, branch: string) => Promise<void>;
  trackerIssue?: TrackerIssue;
  onTrackerStatusChange?: (issueId: string, status: TrackerIssueStatus) => void;
  onNavigateToDiff?: (filePath: string) => void;
}

const EVENT_ICONS: Record<ChronicleEventType, typeof MessageSquare> = {
  message: MessageSquare,
  file: FileText,
  git: GitCommit,
  terminal: Terminal,
  error: AlertCircle,
  session: Hammer,
};

const CI_ICONS: Record<CIStatusValue, typeof CheckCircle2> = {
  passed: CheckCircle2,
  failed: XCircle,
  running: Loader2,
  pending: Clock,
  unknown: Clock,
};

function formatTimestamp(seconds: number): string {
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${mm}:${ss < 10 ? '0' : ''}${ss}`;
}

export function SessionChronicles({
  session,
  sessionId,
  sessionStatus,
  chronicle,
  loading,
  onFetch,
  className,
  repoUrl,
  branch,
  pullRequest,
  prLoading,
  prCreating,
  prMerging,
  onFetchPR,
  onCreatePR,
  onMergePR,
  onRefreshCI,
  trackerIssue,
  onTrackerStatusChange,
  onNavigateToDiff,
}: SessionChroniclesProps) {
  const [prTitle, setPrTitle] = useState('');

  const contextSidebar = useContextSidebar(session ?? null, chronicle, pullRequest);

  useEffect(() => {
    onFetch(sessionId);
  }, [sessionId, onFetch]);

  useEffect(() => {
    if (repoUrl && branch) {
      onFetchPR(repoUrl, branch);
    }
  }, [repoUrl, branch, onFetchPR]);

  const handleCreatePR = () => {
    onCreatePR(sessionId, prTitle || undefined);
    setPrTitle('');
  };

  const handleMergePR = () => {
    if (!pullRequest) {
      return;
    }
    onMergePR(pullRequest.number, pullRequest.repoUrl);
  };

  const handleRefreshCI = () => {
    if (!pullRequest) {
      return;
    }
    onRefreshCI(pullRequest.number, pullRequest.repoUrl, pullRequest.sourceBranch);
  };

  const sidebarElement = session ? (
    <ContextSidebar
      collapsed={contextSidebar.collapsed}
      onToggle={contextSidebar.toggleCollapsed}
      tokenUsage={contextSidebar.tokenUsage}
      activeTasks={contextSidebar.activeTasks}
      pullRequest={contextSidebar.pullRequest}
      mcpServers={contextSidebar.mcpServers}
      mcpServersLoading={contextSidebar.mcpServersLoading}
      modelConfig={contextSidebar.modelConfig}
    />
  ) : null;

  if (loading) {
    return (
      <div className={cn(styles.outerWrapper, className)}>
        <div className={styles.container}>
          <div className={styles.loading}>Loading chronicle...</div>
        </div>
        {sidebarElement}
      </div>
    );
  }

  if (!chronicle) {
    return (
      <div className={cn(styles.outerWrapper, className)}>
        <div className={styles.container}>
          <div className={styles.empty}>
            <History className={styles.emptyIcon} />
            <p className={styles.emptyText}>
              {sessionStatus === 'running'
                ? 'No chronicle data yet'
                : 'Start the session to view its chronicle'}
            </p>
          </div>
        </div>
        {sidebarElement}
      </div>
    );
  }

  const maxBurn = Math.max(...chronicle.tokenBurn);

  return (
    <div className={cn(styles.outerWrapper, className)}>
      <div className={styles.container}>
        {/* Token Burn Rate */}
        <div className={styles.burnSection}>
          <div className={styles.burnHeader}>
            <span className={styles.burnLabel}>Token Burn Rate</span>
            <span className={styles.burnSubLabel}>5-minute buckets</span>
          </div>
          <div className={styles.burnChart}>
            {chronicle.tokenBurn.map((v, i) => {
              const height = `${(v / maxBurn) * 100}%`;
              return (
                <div
                  key={i}
                  className={cn(styles.burnBar, v > maxBurn * 0.75 && styles.burnBarHot)}
                  style={{ '--bar-height': height } as CSSProperties}
                />
              );
            })}
          </div>
        </div>

        <div className={styles.grid}>
          {/* Timeline */}
          <div className={styles.timeline}>
            <div className={styles.timelineInner}>
              <div className={styles.timelineLine} />
              {chronicle.events.map((e, i) => {
                const Icon = EVENT_ICONS[e.type];
                return (
                  <div key={i} className={styles.event} data-type={e.type}>
                    <div className={styles.eventDot} data-type={e.type} />
                    <span className={styles.eventTime}>{formatTimestamp(e.t)}</span>
                    <div
                      className={cn(
                        styles.eventContent,
                        e.type === 'error' && styles.eventContentError
                      )}
                    >
                      <div className={styles.eventMain}>
                        <div className={styles.eventLeft}>
                          <span className={styles.eventIcon} data-type={e.type}>
                            <Icon className={styles.eventIconSvg} />
                          </span>
                          <span className={styles.eventLabel}>{e.label}</span>
                          {e.action && <span className={styles.eventAction}>({e.action})</span>}
                        </div>
                        <div className={styles.eventMeta}>
                          {e.tokens !== undefined && (
                            <span className={styles.metaTokens}>
                              {e.tokens.toLocaleString()} tok
                            </span>
                          )}
                          {e.ins !== undefined && (
                            <span className={styles.metaDiff}>
                              <span className={styles.metaIns}>+{e.ins}</span>
                              {e.del !== undefined && e.del > 0 && (
                                <span className={styles.metaDel}> -{e.del}</span>
                              )}
                            </span>
                          )}
                          {e.hash && <span className={styles.metaHash}>{e.hash}</span>}
                          {e.exit !== undefined && (
                            <span
                              className={e.exit === 0 ? styles.metaExitOk : styles.metaExitFail}
                            >
                              exit {e.exit}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sidebar */}
          <div className={styles.sidebar}>
            {trackerIssue && onTrackerStatusChange && (
              <div className={styles.sidebarPanel}>
                <h3 className={styles.sidebarTitle}>Issue</h3>
                <TrackerIssueSection issue={trackerIssue} onStatusChange={onTrackerStatusChange} />
              </div>
            )}

            <div className={styles.sidebarPanel}>
              <h3 className={styles.sidebarTitle}>Files Modified</h3>
              <div className={styles.fileList}>
                {chronicle.files.map((f, i) => (
                  <div
                    key={i}
                    className={cn(styles.fileRow, onNavigateToDiff && styles.fileRowClickable)}
                    onClick={() => onNavigateToDiff?.(f.path)}
                    role={onNavigateToDiff ? 'button' : undefined}
                    tabIndex={onNavigateToDiff ? 0 : undefined}
                    onKeyDown={
                      onNavigateToDiff
                        ? e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              onNavigateToDiff(f.path);
                            }
                          }
                        : undefined
                    }
                  >
                    <span className={styles.fileStatus} data-status={f.status}>
                      {f.status}
                    </span>
                    <span className={styles.filePath}>{f.path}</span>
                    <span className={styles.fileDiff}>
                      <span className={styles.metaIns}>+{f.ins}</span>
                      {f.del > 0 && <span className={styles.metaDel}> -{f.del}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Pull Request Panel */}
            <div className={styles.sidebarPanel}>
              <h3 className={styles.sidebarTitle}>Pull Request</h3>
              {prLoading ? (
                <div className={styles.prLoading}>Loading PR status...</div>
              ) : pullRequest ? (
                <div className={styles.prCard}>
                  <div className={styles.prHeader}>
                    <div className={styles.prTitleRow}>
                      {pullRequest.status === 'merged' ? (
                        <GitMerge className={styles.prIcon} data-status="merged" />
                      ) : (
                        <GitPullRequest
                          className={styles.prIcon}
                          data-status={pullRequest.status}
                        />
                      )}
                      <span className={styles.prNumber}>#{pullRequest.number}</span>
                      <span className={styles.prStatusBadge} data-status={pullRequest.status}>
                        {pullRequest.status}
                      </span>
                    </div>
                    <a
                      className={styles.prLink}
                      href={pullRequest.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className={styles.prLinkIcon} />
                    </a>
                  </div>
                  <p className={styles.prTitle}>{pullRequest.title}</p>
                  <div className={styles.prBranches}>
                    <span className={styles.prBranch}>{pullRequest.sourceBranch}</span>
                    <span className={styles.prArrow}>&rarr;</span>
                    <span className={styles.prBranch}>{pullRequest.targetBranch}</span>
                  </div>

                  {/* CI Status */}
                  <div className={styles.ciRow}>
                    {(() => {
                      const ciStatus = pullRequest.ciStatus ?? 'unknown';
                      const CIIcon = CI_ICONS[ciStatus];
                      return (
                        <>
                          <span className={styles.ciIndicator} data-status={ciStatus}>
                            <CIIcon
                              className={cn(
                                styles.ciIcon,
                                ciStatus === 'running' && styles.ciIconSpin
                              )}
                            />
                            <span className={styles.ciLabel}>
                              {ciStatus === 'passed' && 'CI Passed'}
                              {ciStatus === 'failed' && 'CI Failed'}
                              {ciStatus === 'running' && 'CI Running'}
                              {ciStatus === 'pending' && 'CI Pending'}
                              {ciStatus === 'unknown' && 'CI Unknown'}
                            </span>
                          </span>
                          <button
                            type="button"
                            className={styles.ciRefresh}
                            onClick={handleRefreshCI}
                            title="Refresh CI status"
                          >
                            <RefreshCw className={styles.ciRefreshIcon} />
                          </button>
                        </>
                      );
                    })()}
                  </div>

                  {/* Merge button */}
                  {pullRequest.status === 'open' && (
                    <button
                      type="button"
                      className={styles.mergeButton}
                      onClick={handleMergePR}
                      disabled={prMerging || pullRequest.ciStatus === 'failed'}
                    >
                      {prMerging ? (
                        <>
                          <Loader2 className={cn(styles.mergeIcon, styles.ciIconSpin)} />
                          Merging...
                        </>
                      ) : (
                        <>
                          <GitMerge className={styles.mergeIcon} />
                          Merge PR
                        </>
                      )}
                    </button>
                  )}
                  {pullRequest.status === 'merged' && (
                    <div className={styles.mergedBanner}>
                      <GitMerge className={styles.mergedIcon} />
                      Merged
                    </div>
                  )}
                </div>
              ) : (
                <div className={styles.prCreate}>
                  <input
                    type="text"
                    className={styles.prInput}
                    placeholder="PR title (optional)"
                    value={prTitle}
                    onChange={e => setPrTitle(e.target.value)}
                    disabled={prCreating}
                  />
                  <button
                    type="button"
                    className={styles.createPrButton}
                    onClick={handleCreatePR}
                    disabled={prCreating || !chronicle.commits.length}
                  >
                    {prCreating ? (
                      <>
                        <Loader2 className={cn(styles.createPrIcon, styles.ciIconSpin)} />
                        Creating...
                      </>
                    ) : (
                      <>
                        <GitPullRequest className={styles.createPrIcon} />
                        Create PR
                      </>
                    )}
                  </button>
                  {!chronicle.commits.length && (
                    <span className={styles.prHint}>Commit changes first</span>
                  )}
                </div>
              )}
            </div>

            <div className={styles.sidebarPanel}>
              <h3 className={styles.sidebarTitle}>Commits</h3>
              <div className={styles.commitList}>
                {chronicle.commits.map((c, i) => (
                  <div key={i} className={styles.commitRow}>
                    <GitCommit className={styles.commitIcon} />
                    <div className={styles.commitInfo}>
                      <p className={styles.commitMsg}>{c.msg}</p>
                      <div className={styles.commitMeta}>
                        <span className={styles.commitHash}>{c.hash}</span>
                        <span>{c.time}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {sidebarElement}
    </div>
  );
}

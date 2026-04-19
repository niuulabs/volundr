import { useState } from 'react';
import { useService } from '@niuulabs/plugin-sdk';
import { useQuery } from '@tanstack/react-query';
import { LifecycleBadge, LoadingState, ErrorState } from '@niuulabs/ui';
import { Terminal } from './Terminal/Terminal';
import { FileTree } from './FileTree/FileTree';
import { FileViewer } from './FileTree/FileViewer';
import { OverviewTab } from './detail/tabs/OverviewTab';
import { ExecTab } from './detail/tabs/ExecTab';
import { EventsTab } from './detail/tabs/EventsTab';
import { MetricsTab } from './detail/tabs/MetricsTab';
import { useExec } from './hooks/useExec';
import { useMetrics } from './hooks/useMetrics';
import { useSessionDetail } from './hooks/useSessionStore';
import { toLifecycleState } from './utils/toLifecycleState';
import type { IPtyStream } from '../ports/IPtyStream';
import type { IFileSystemPort, FileTreeNode } from '../ports/IFileSystemPort';

export type SessionTab = 'overview' | 'terminal' | 'files' | 'exec' | 'events' | 'metrics';

const TABS: { id: SessionTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'files', label: 'Files' },
  { id: 'exec', label: 'Exec' },
  { id: 'events', label: 'Events' },
  { id: 'metrics', label: 'Metrics' },
];

export interface SessionDetailPageProps {
  sessionId: string;
  readOnly?: boolean;
  initialTab?: SessionTab;
}

/** Six-tab session detail page (Overview / Terminal / Files / Exec / Events / Metrics). */
export function SessionDetailPage({
  sessionId,
  readOnly = false,
  initialTab = 'overview',
}: SessionDetailPageProps) {
  const [activeTab, setActiveTab] = useState<SessionTab>(initialTab);
  const [activePath, setActivePath] = useState<string | undefined>(undefined);
  const [fileContent, setFileContent] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | undefined>(undefined);

  const ptyStream = useService<IPtyStream>('ptyStream');
  const filesystem = useService<IFileSystemPort>('filesystem');

  const sessionQuery = useSessionDetail(sessionId);

  const treeQuery = useQuery<FileTreeNode[]>({
    queryKey: ['volundr', 'filetree', sessionId],
    queryFn: () => filesystem.listTree(sessionId),
    enabled: activeTab === 'files',
  });

  const exec = useExec(sessionId, ptyStream);
  const metrics = useMetrics(sessionId);

  async function handleOpenFile(path: string) {
    setActivePath(path);
    setFileLoading(true);
    setFileError(undefined);
    setFileContent('');
    try {
      const content = await filesystem.readFile(sessionId, path);
      setFileContent(content);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Failed to load file');
    } finally {
      setFileLoading(false);
    }
  }

  const session = sessionQuery.data;

  return (
    <div className="niuu-flex niuu-h-full niuu-flex-col" data-testid="session-detail-page">
      {/* Header */}
      <div className="niuu-flex niuu-items-center niuu-gap-3 niuu-border-b niuu-border-border-subtle niuu-bg-bg-secondary niuu-px-4 niuu-py-2">
        <span
          className="niuu-font-mono niuu-text-sm niuu-text-text-primary"
          data-testid="session-id-label"
        >
          {sessionId}
        </span>

        {session && <LifecycleBadge state={toLifecycleState(session.state)} />}

        {readOnly && (
          <span
            className="niuu-rounded niuu-bg-bg-elevated niuu-px-2 niuu-py-0.5 niuu-text-xs niuu-text-text-muted"
            data-testid="session-archived-badge"
          >
            archived
          </span>
        )}
      </div>

      {/* Tab bar */}
      <div
        className="niuu-flex niuu-items-center niuu-gap-0 niuu-border-b niuu-border-border-subtle niuu-bg-bg-secondary"
        role="tablist"
        aria-label="Session tabs"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            data-testid={`tab-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={
              activeTab === tab.id
                ? 'niuu-border-b-2 niuu-border-brand niuu-px-4 niuu-py-2 niuu-text-sm niuu-font-medium niuu-text-brand'
                : 'niuu-border-b-2 niuu-border-transparent niuu-px-4 niuu-py-2 niuu-text-sm niuu-text-text-muted hover:niuu-text-text-secondary'
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div className="niuu-min-h-0 niuu-flex-1 niuu-overflow-auto">
        {/* Overview */}
        <div role="tabpanel" aria-labelledby="tab-overview" hidden={activeTab !== 'overview'}>
          {activeTab === 'overview' && sessionQuery.isLoading && (
            <LoadingState label="Loading session…" />
          )}
          {activeTab === 'overview' && sessionQuery.isError && (
            <ErrorState
              title="Failed to load session"
              message={
                sessionQuery.error instanceof Error ? sessionQuery.error.message : 'Unknown error'
              }
            />
          )}
          {activeTab === 'overview' && session && <OverviewTab session={session} />}
        </div>

        {/* Terminal */}
        <div
          role="tabpanel"
          aria-labelledby="tab-terminal"
          hidden={activeTab !== 'terminal'}
          className="niuu-h-full niuu-min-h-[300px]"
        >
          {activeTab === 'terminal' && (
            <Terminal sessionId={sessionId} stream={ptyStream} readOnly={readOnly} />
          )}
        </div>

        {/* Files */}
        <div
          role="tabpanel"
          aria-labelledby="tab-files"
          hidden={activeTab !== 'files'}
          className="niuu-grid niuu-h-full niuu-grid-cols-[220px_1fr] niuu-gap-4 niuu-p-4"
        >
          {activeTab === 'files' && (
            <>
              <div className="niuu-overflow-auto niuu-rounded-md niuu-border niuu-border-border-subtle niuu-bg-bg-secondary">
                {treeQuery.isLoading && (
                  <p
                    className="niuu-p-3 niuu-text-xs niuu-text-text-muted"
                    data-testid="filetree-loading"
                  >
                    loading files…
                  </p>
                )}
                {treeQuery.isError && (
                  <p
                    className="niuu-p-3 niuu-text-xs niuu-text-critical"
                    data-testid="filetree-error"
                  >
                    failed to load files
                  </p>
                )}
                {treeQuery.data && (
                  <FileTree
                    nodes={treeQuery.data}
                    onOpenFile={handleOpenFile}
                    activePath={activePath}
                  />
                )}
              </div>

              <div className="niuu-overflow-hidden">
                {activePath ? (
                  <FileViewer
                    path={activePath}
                    content={fileContent}
                    isLoading={fileLoading}
                    error={fileError}
                    onClose={() => setActivePath(undefined)}
                  />
                ) : (
                  <div
                    className="niuu-flex niuu-h-full niuu-items-center niuu-justify-center niuu-rounded-md niuu-border niuu-border-border-subtle niuu-text-sm niuu-text-text-muted"
                    data-testid="file-viewer-placeholder"
                  >
                    Select a file to view its contents
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Exec */}
        <div
          role="tabpanel"
          aria-labelledby="tab-exec"
          hidden={activeTab !== 'exec'}
          className="niuu-h-full"
        >
          {activeTab === 'exec' && <ExecTab exec={exec} />}
        </div>

        {/* Events */}
        <div role="tabpanel" aria-labelledby="tab-events" hidden={activeTab !== 'events'}>
          {activeTab === 'events' && sessionQuery.isLoading && (
            <LoadingState label="Loading events…" />
          )}
          {activeTab === 'events' && session && <EventsTab events={session.events} />}
        </div>

        {/* Metrics */}
        <div role="tabpanel" aria-labelledby="tab-metrics" hidden={activeTab !== 'metrics'}>
          {activeTab === 'metrics' && <MetricsTab metrics={metrics} />}
        </div>
      </div>
    </div>
  );
}

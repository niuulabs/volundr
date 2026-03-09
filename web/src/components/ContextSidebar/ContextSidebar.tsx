import type { CSSProperties } from 'react';
import {
  PanelRightClose,
  PanelRightOpen,
  Flame,
  ListTodo,
  GitPullRequest,
  GitMerge,
  Server,
  Cpu,
  ExternalLink,
} from 'lucide-react';
import type { PullRequest, McpServer } from '@/models';
import type { TokenUsageData, ActiveTask, ModelConfigData } from '@/hooks';
import { cn } from '@/utils';
import styles from './ContextSidebar.module.css';

export interface ContextSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  tokenUsage: TokenUsageData | null;
  activeTasks: ActiveTask[];
  pullRequest: PullRequest | null;
  mcpServers: McpServer[];
  mcpServersLoading: boolean;
  modelConfig: ModelConfigData | null;
  className?: string;
}

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return count.toString();
}

function formatTimestamp(seconds: number): string {
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${mm}:${ss < 10 ? '0' : ''}${ss}`;
}

/* ---------- Sub-sections ---------- */

function TokenUsageSection({ data }: { data: TokenUsageData }) {
  const maxBurn = data.peakBurn || 1;

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <Flame className={styles.sectionIcon} />
        <span className={styles.sectionTitle}>Token Usage</span>
      </div>
      <div className={styles.tokenStats}>
        <div className={styles.tokenStat}>
          <span className={styles.tokenStatLabel}>Total</span>
          <span className={styles.tokenStatValue}>{formatTokenCount(data.totalTokens)}</span>
        </div>
        <div className={styles.tokenStat}>
          <span className={styles.tokenStatLabel}>Peak</span>
          <span className={styles.tokenStatValue}>{data.peakBurn}</span>
        </div>
        <div className={styles.tokenStat}>
          <span className={styles.tokenStatLabel}>Avg</span>
          <span className={styles.tokenStatValue}>{data.averageBurn}</span>
        </div>
      </div>
      <div className={styles.burnMini}>
        {data.burnRate.map((v, i) => (
          <div
            key={i}
            className={cn(styles.burnMiniBar, v > maxBurn * 0.75 && styles.burnMiniBarHot)}
            style={{ '--bar-h': `${(v / maxBurn) * 100}%` } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}

function ActiveTasksSection({ tasks }: { tasks: ActiveTask[] }) {
  if (tasks.length === 0) {
    return null;
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <ListTodo className={styles.sectionIcon} />
        <span className={styles.sectionTitle}>Recent Activity</span>
      </div>
      <div className={styles.taskList}>
        {tasks.map((task, i) => (
          <div key={i} className={styles.taskRow}>
            <span className={styles.taskTime}>{formatTimestamp(task.timestamp)}</span>
            <span className={styles.taskLabel}>{task.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PullRequestSection({ pr }: { pr: PullRequest }) {
  const StatusIcon = pr.status === 'merged' ? GitMerge : GitPullRequest;

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <GitPullRequest className={styles.sectionIcon} />
        <span className={styles.sectionTitle}>Pull Request</span>
      </div>
      <div className={styles.prCard}>
        <div className={styles.prRow}>
          <StatusIcon className={styles.prStatusIcon} data-status={pr.status} />
          <span className={styles.prNumber}>#{pr.number}</span>
          <span className={styles.prBadge} data-status={pr.status}>
            {pr.status}
          </span>
          <a
            className={styles.prExtLink}
            href={pr.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open PR"
          >
            <ExternalLink className={styles.prExtIcon} />
          </a>
        </div>
        <p className={styles.prTitle}>{pr.title}</p>
        <div className={styles.prBranches}>
          <span className={styles.prBranch}>{pr.sourceBranch}</span>
          <span className={styles.prArrow}>&rarr;</span>
          <span className={styles.prBranch}>{pr.targetBranch}</span>
        </div>
      </div>
    </div>
  );
}

function McpServersSection({ servers, loading }: { servers: McpServer[]; loading: boolean }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <Server className={styles.sectionIcon} />
        <span className={styles.sectionTitle}>MCP Servers</span>
      </div>
      {loading ? (
        <span className={styles.mcpLoading}>Loading...</span>
      ) : servers.length === 0 ? (
        <span className={styles.mcpEmpty}>No servers connected</span>
      ) : (
        <div className={styles.mcpList}>
          {servers.map(server => (
            <div key={server.name} className={styles.mcpRow}>
              <span className={styles.mcpDot} data-status={server.status} />
              <span className={styles.mcpName}>{server.name}</span>
              <span className={styles.mcpTools}>{server.tools} tools</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ModelConfigSection({ config }: { config: ModelConfigData }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <Cpu className={styles.sectionIcon} />
        <span className={styles.sectionTitle}>Model & Config</span>
      </div>
      <div className={styles.configList}>
        <div className={styles.configRow}>
          <span className={styles.configLabel}>Model</span>
          <span className={styles.configValue}>{config.model}</span>
        </div>
        <div className={styles.configRow}>
          <span className={styles.configLabel}>Task</span>
          <span className={styles.configValue}>{config.taskType}</span>
        </div>
        {config.taskDescription && (
          <div className={styles.configRow}>
            <span className={styles.configLabel}>Desc</span>
            <span className={styles.configValue}>{config.taskDescription}</span>
          </div>
        )}
        <div className={styles.configRow}>
          <span className={styles.configLabel}>Repo</span>
          <span className={styles.configValueMono}>{config.repo}</span>
        </div>
        <div className={styles.configRow}>
          <span className={styles.configLabel}>Branch</span>
          <span className={styles.configValueMono}>{config.branch}</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- Main component ---------- */

export function ContextSidebar({
  collapsed,
  onToggle,
  tokenUsage,
  activeTasks,
  pullRequest,
  mcpServers,
  mcpServersLoading,
  modelConfig,
  className,
}: ContextSidebarProps) {
  return (
    <div className={cn(styles.container, collapsed && styles.collapsed, className)}>
      <button
        type="button"
        className={styles.toggleButton}
        onClick={onToggle}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? (
          <PanelRightOpen className={styles.toggleIcon} />
        ) : (
          <PanelRightClose className={styles.toggleIcon} />
        )}
      </button>

      {!collapsed && (
        <div className={styles.content}>
          {tokenUsage && <TokenUsageSection data={tokenUsage} />}
          <ActiveTasksSection tasks={activeTasks} />
          {pullRequest && <PullRequestSection pr={pullRequest} />}
          <McpServersSection servers={mcpServers} loading={mcpServersLoading} />
          {modelConfig && <ModelConfigSection config={modelConfig} />}
        </div>
      )}
    </div>
  );
}

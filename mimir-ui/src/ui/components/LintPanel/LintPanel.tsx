import type { MimirLintReport } from '@/domain';
import styles from './LintPanel.module.css';

interface LintPanelProps {
  report: MimirLintReport | null;
  onPageClick: (path: string) => void;
}

interface IssueGroupProps {
  title: string;
  paths: string[];
  variant: 'error' | 'warning' | 'info';
  onPageClick: (path: string) => void;
}

function IssueGroup({ title, paths, variant, onPageClick }: IssueGroupProps) {
  if (paths.length === 0) {
    return null;
  }

  return (
    <section className={styles.issueGroup}>
      <h3 className={styles.groupTitle} data-variant={variant}>
        <span className={styles.groupCount}>{paths.length}</span>
        {title}
      </h3>
      <ul className={styles.pathList} role="list">
        {paths.map((path) => (
          <li key={path} className={styles.pathItem}>
            <button
              className={styles.pathButton}
              onClick={() => onPageClick(path)}
              title={`Open ${path}`}
            >
              {path}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LintPanel({ report, onPageClick }: LintPanelProps) {
  if (!report) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyText}>Run a lint check to see the health report</span>
      </div>
    );
  }

  const totalIssues =
    report.orphans.length +
    report.contradictions.length +
    report.stale.length +
    report.gaps.length;

  return (
    <div className={styles.panel}>
      <header className={styles.summary}>
        <div className={styles.summaryStats}>
          <div className={styles.stat}>
            <span className={styles.statValue}>{report.pagesChecked}</span>
            <span className={styles.statLabel}>pages checked</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue} data-has-issues={totalIssues > 0}>
              {totalIssues}
            </span>
            <span className={styles.statLabel}>issues found</span>
          </div>
        </div>
        <span className={styles.healthBadge} data-healthy={!report.issuesFound}>
          <span className={styles.healthDot} aria-hidden="true" />
          {report.issuesFound ? 'Issues detected' : 'All clear'}
        </span>
      </header>

      {!report.issuesFound && (
        <div className={styles.allClear}>
          <span className={styles.allClearText}>No issues found. Knowledge base looks healthy.</span>
        </div>
      )}

      <div className={styles.issueGroups}>
        <IssueGroup
          title="Orphaned pages"
          paths={report.orphans}
          variant="warning"
          onPageClick={onPageClick}
        />
        <IssueGroup
          title="Contradictions"
          paths={report.contradictions}
          variant="error"
          onPageClick={onPageClick}
        />
        <IssueGroup
          title="Stale pages"
          paths={report.stale}
          variant="warning"
          onPageClick={onPageClick}
        />
        <IssueGroup
          title="Knowledge gaps"
          paths={report.gaps}
          variant="info"
          onPageClick={onPageClick}
        />
      </div>
    </div>
  );
}

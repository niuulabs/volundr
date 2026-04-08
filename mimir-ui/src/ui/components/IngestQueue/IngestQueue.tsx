import type { IngestJob, IngestStatus } from '@/domain';
import styles from './IngestQueue.module.css';

interface IngestQueueProps {
  jobs: IngestJob[];
}

function statusLabel(status: IngestStatus): string {
  switch (status) {
    case 'queued': return 'Queued';
    case 'running': return 'Running';
    case 'complete': return 'Complete';
    case 'failed': return 'Failed';
  }
}

function JobCard({ job }: { job: IngestJob }) {
  return (
    <li className={styles.jobCard} data-status={job.status}>
      <div className={styles.jobHeader}>
        <span className={styles.statusBadge} data-status={job.status}>
          {job.status === 'running' && <span className={styles.spinner} aria-hidden="true" />}
          {statusLabel(job.status)}
        </span>
        <span className={styles.sourceType}>{job.sourceType}</span>
        <span className={styles.instanceName}>{job.instanceName}</span>
      </div>

      <div className={styles.jobBody}>
        <p className={styles.jobTitle}>{job.title}</p>

        {job.status === 'running' && job.currentActivity && (
          <p className={styles.activity}>{job.currentActivity}</p>
        )}

        {job.status === 'failed' && job.errorMessage && (
          <p className={styles.errorMessage}>{job.errorMessage}</p>
        )}

        {job.pagesUpdated.length > 0 && (
          <div className={styles.pagesUpdated}>
            <span className={styles.pagesLabel}>Pages updated:</span>
            <ul className={styles.pagesList} role="list">
              {job.pagesUpdated.map((path) => (
                <li key={path} className={styles.pageEntry}>{path}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </li>
  );
}

export function IngestQueue({ jobs }: IngestQueueProps) {
  if (jobs.length === 0) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyText}>No ingest jobs</span>
      </div>
    );
  }

  const running = jobs.filter((j) => j.status === 'running');
  const queued = jobs.filter((j) => j.status === 'queued');
  const finished = jobs.filter((j) => j.status === 'complete' || j.status === 'failed');

  return (
    <div className={styles.queue}>
      <div className={styles.queueHeader}>
        <span className={styles.queueTitle}>Ingest Queue</span>
        <div className={styles.queueStats}>
          {running.length > 0 && (
            <span className={styles.queueStat} data-status="running">
              {running.length} running
            </span>
          )}
          {queued.length > 0 && (
            <span className={styles.queueStat} data-status="queued">
              {queued.length} queued
            </span>
          )}
          {finished.length > 0 && (
            <span className={styles.queueStat} data-status="done">
              {finished.length} done
            </span>
          )}
        </div>
      </div>

      <ul className={styles.jobList} role="list">
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
      </ul>
    </div>
  );
}

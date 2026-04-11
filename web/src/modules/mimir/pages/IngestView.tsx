import { useState, useCallback } from 'react';
import type { IngestJob, IngestRequest } from '../api/types';
import { transitionJob } from '../api/types';
import * as mimirClient from '../api/client';
import { IngestDropzone } from '../components/IngestDropzone/IngestDropzone';
import { IngestQueue } from '../components/IngestQueue/IngestQueue';
import styles from './IngestView.module.css';

let jobIdCounter = 0;

function makeJobId(): string {
  jobIdCounter += 1;
  return `local-${Date.now()}-${jobIdCounter}`;
}

export function IngestView() {
  const [jobs, setJobs] = useState<IngestJob[]>([]);

  const handleIngest = useCallback(
    async (
      title: string,
      content: string,
      sourceType: IngestRequest['sourceType'],
      originUrl?: string
    ) => {
      const jobId = makeJobId();
      const newJob: IngestJob = {
        id: jobId,
        title,
        sourceType,
        status: 'queued',
        instanceName: 'default',
        pagesUpdated: [],
        startedAt: new Date().toISOString(),
      };

      setJobs(prev => [newJob, ...prev]);

      try {
        const response = await mimirClient.ingest({ title, content, sourceType, originUrl });
        setJobs(prev =>
          prev.map(job =>
            job.id === jobId
              ? transitionJob(job, {
                  id: response.sourceId,
                  status: 'complete',
                  pagesUpdated: response.pagesUpdated,
                  completedAt: new Date().toISOString(),
                })
              : job
          )
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Ingest failed';
        setJobs(prev =>
          prev.map(job =>
            job.id === jobId
              ? transitionJob(job, {
                  status: 'failed',
                  errorMessage: message,
                  completedAt: new Date().toISOString(),
                })
              : job
          )
        );
      }
    },
    []
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Ingest Knowledge</h1>
        <p className={styles.subheading}>Add documents, URLs, or text to the knowledge base</p>
      </div>

      <div className={styles.dropzoneSection}>
        <IngestDropzone onIngest={handleIngest} />
      </div>

      <div className={styles.queueSection}>
        <h2 className={styles.queueHeading}>Queue</h2>
        {jobs.length === 0 ? (
          <p className={styles.emptyQueue}>No jobs yet. Submit content above to get started.</p>
        ) : (
          <IngestQueue jobs={jobs} />
        )}
      </div>
    </div>
  );
}

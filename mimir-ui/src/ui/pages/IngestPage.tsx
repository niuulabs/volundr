import { useState, useEffect, useCallback } from 'react';
import type { IngestJob, IngestRequest } from '@/domain';
import { transitionJob, isTerminal } from '@/domain';
import { useActivePorts, usePorts } from '@/contexts/PortsContext';
import { IngestDropzone } from '@/ui/components/IngestDropzone/IngestDropzone';
import { IngestQueue } from '@/ui/components/IngestQueue/IngestQueue';
import styles from './IngestPage.module.css';

let jobIdCounter = 0;

function makeJobId(): string {
  jobIdCounter += 1;
  return `local-${Date.now()}-${jobIdCounter}`;
}

export function IngestPage() {
  const { instances, activeInstanceName } = usePorts();
  const { ingest, events, instance } = useActivePorts();

  const [jobs, setJobs] = useState<IngestJob[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    setIsConnected(events.isConnected());

    const unsubscribe = events.subscribe((event) => {
      setIsConnected(events.isConnected());

      if (
        event.type === 'ingest_running' ||
        event.type === 'ingest_complete' ||
        event.type === 'ingest_failed'
      ) {
        setJobs((prev) =>
          prev.map((job) => {
            if (event.sourceId && !job.id.startsWith('local-')) return job;

            if (event.type === 'ingest_running') {
              return transitionJob(job, {
                status: 'running',
                currentActivity: event.message,
                startedAt: event.timestamp,
              });
            }

            if (event.type === 'ingest_complete') {
              return isTerminal(job.status)
                ? job
                : transitionJob(job, {
                    status: 'complete',
                    completedAt: event.timestamp,
                    currentActivity: undefined,
                  });
            }

            if (event.type === 'ingest_failed') {
              return isTerminal(job.status)
                ? job
                : transitionJob(job, {
                    status: 'failed',
                    completedAt: event.timestamp,
                    errorMessage: event.message,
                    currentActivity: undefined,
                  });
            }

            return job;
          }),
        );
      }
    });

    return unsubscribe;
  }, [events]);

  const handleIngest = useCallback(
    async (
      _instanceName: string,
      title: string,
      content: string,
      sourceType: IngestRequest['sourceType'],
      originUrl?: string,
    ) => {
      const jobId = makeJobId();
      const newJob: IngestJob = {
        id: jobId,
        title,
        sourceType,
        status: 'queued',
        instanceName: activeInstanceName,
        pagesUpdated: [],
        startedAt: new Date().toISOString(),
      };

      setJobs((prev) => [newJob, ...prev]);

      try {
        const response = await ingest.ingest({ title, content, sourceType, originUrl });
        setJobs((prev) =>
          prev.map((job) =>
            job.id === jobId
              ? transitionJob(job, {
                  id: response.sourceId,
                  status: 'complete',
                  pagesUpdated: response.pagesUpdated,
                  completedAt: new Date().toISOString(),
                })
              : job,
          ),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Ingest failed';
        setJobs((prev) =>
          prev.map((job) =>
            job.id === jobId
              ? transitionJob(job, {
                  status: 'failed',
                  errorMessage: message,
                  completedAt: new Date().toISOString(),
                })
              : job,
          ),
        );
      }
    },
    [ingest, activeInstanceName],
  );

  const allInstances = instances.map((i) => ({
    name: i.instance.name,
    writeEnabled: i.instance.writeEnabled,
  }));

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Ingest Knowledge</h1>
        <p className={styles.subheading}>
          Add documents, URLs, or text to {instance.name}
        </p>
        <div className={styles.connectionBadge}>
          <span
            className={styles.connectionDot}
            data-connected={isConnected ? 'true' : 'false'}
          />
          {isConnected ? 'Live updates connected' : 'Polling for updates'}
        </div>
      </div>

      <div className={styles.dropzoneSection}>
        <IngestDropzone
          onIngest={handleIngest}
          instances={allInstances}
          activeInstanceName={activeInstanceName}
        />
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

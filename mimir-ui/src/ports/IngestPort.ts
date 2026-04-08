import type { IngestRequest, IngestResponse } from '@/domain';

/**
 * Port interface for triggering knowledge ingestion on a Mímir instance.
 */
export interface IngestPort {
  /**
   * Submit a source for ingestion. Returns immediately with source_id;
   * progress is tracked via EventPort.
   */
  ingest(request: IngestRequest): Promise<IngestResponse>;
}

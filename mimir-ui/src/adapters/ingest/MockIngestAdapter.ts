import type { IngestPort } from '@/ports';
import type { IngestRequest, IngestResponse } from '@/domain';

/**
 * MockIngestAdapter — deterministic test double for IngestPort.
 * Counter is instance-scoped to prevent test leakage.
 */
export class MockIngestAdapter implements IngestPort {
  readonly submissions: IngestRequest[] = [];
  private counter = 0;

  async ingest(request: IngestRequest): Promise<IngestResponse> {
    this.submissions.push(request);
    this.counter += 1;
    return {
      sourceId: `src_mock_${this.counter.toString().padStart(4, '0')}`,
      pagesUpdated: [`technical/mock/page-${this.counter}.md`],
    };
  }
}

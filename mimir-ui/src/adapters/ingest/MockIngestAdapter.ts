import type { IngestPort } from '@/ports';
import type { IngestRequest, IngestResponse } from '@/domain';

let counter = 0;

/**
 * MockIngestAdapter — deterministic test double for IngestPort.
 */
export class MockIngestAdapter implements IngestPort {
  readonly submissions: IngestRequest[] = [];

  async ingest(request: IngestRequest): Promise<IngestResponse> {
    this.submissions.push(request);
    counter += 1;
    return {
      sourceId: `src_mock_${counter.toString().padStart(4, '0')}`,
      pagesUpdated: [`technical/mock/page-${counter}.md`],
    };
  }
}

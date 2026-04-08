import type { IngestPort } from '@/ports';
import type { IngestRequest, IngestResponse } from '@/domain';

/**
 * HttpIngestAdapter — submits ingestion requests to the Mímir HTTP service.
 */
export class HttpIngestAdapter implements IngestPort {
  constructor(private readonly baseUrl: string) {}

  async ingest(request: IngestRequest): Promise<IngestResponse> {
    const res = await fetch(`${this.baseUrl}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: request.title,
        content: request.content,
        source_type: request.sourceType,
        origin_url: request.originUrl,
      }),
    });
    if (!res.ok) {
      throw new Error(`Ingest HTTP ${res.status}`);
    }
    const raw = (await res.json()) as Record<string, unknown>;
    return {
      sourceId: raw['source_id'] as string,
      pagesUpdated: raw['pages_updated'] as string[],
    };
  }
}

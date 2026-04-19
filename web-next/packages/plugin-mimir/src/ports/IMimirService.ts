import type { IMountAdapter } from './IMountAdapter';
import type { IPageStore } from './IPageStore';
import type { IEmbeddingStore } from './IEmbeddingStore';
import type { ILintEngine } from './ILintEngine';
import type {
  MimirLogEntry,
  IngestRequest,
  IngestResponse,
  DreamCycle,
  Source,
} from '../domain/types';

/**
 * Composite Mimir service interface — the single DI key (`'mimir'`) that wires
 * the four ports into one injectable object.
 *
 * Components use `useService<IMimirService>('mimir')` to get hold of Mimir
 * capabilities without depending on any concrete adapter.
 */
export interface IMimirService extends IMountAdapter, IPageStore, IEmbeddingStore, ILintEngine {
  /** Tail the Mimir service log. */
  getLog(n?: number): Promise<MimirLogEntry>;
  /** Submit a document for ingest. */
  ingest(request: IngestRequest): Promise<IngestResponse>;
  /** List past dream-cycle run records. */
  listDreamCycles(): Promise<DreamCycle[]>;
  /** List raw ingest source records, optionally for a single mount. */
  listSources(mountName?: string): Promise<Source[]>;
}

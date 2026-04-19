/**
 * Port for session persistence.
 *
 * The store is responsible for reading/writing Session aggregates.
 * Adapters may back this with PostgreSQL, in-memory maps, etc.
 */
import type { Session, SessionState } from '../domain/session';

export interface ISessionStore {
  /** Fetch a single session by ID, or null if not found. */
  get(id: string): Promise<Session | null>;

  /** List all sessions, optionally filtered by state. */
  list(filter?: { state?: SessionState; clusterId?: string }): Promise<Session[]>;

  /** Persist a new or updated session. */
  save(session: Session): Promise<Session>;

  /** Remove a session record. */
  delete(id: string): Promise<void>;
}

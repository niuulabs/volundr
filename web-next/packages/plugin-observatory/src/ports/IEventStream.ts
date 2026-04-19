import type { ObservatoryEvent } from '../domain/events';

export interface IEventStream {
  /** Subscribe to Observatory events. Returns an unsubscribe function. */
  subscribe(onEvent: (event: ObservatoryEvent) => void): () => void;
}

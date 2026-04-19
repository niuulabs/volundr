/**
 * Systems that emit events into the Observatory event log.
 *
 * @canonical Observatory — event log strip, README §Events.
 */
export const EVENT_SOURCES = ['RAVN', 'TYR', 'MIMIR', 'BIFROST', 'RAID'] as const;

export type EventSource = (typeof EVENT_SOURCES)[number];

export function isEventSource(value: string): value is EventSource {
  return (EVENT_SOURCES as readonly string[]).includes(value);
}

/** A single event entry in the Observatory event log. */
export interface ObservatoryEvent {
  id: string;
  time: string;
  type: EventSource;
  subject: string;
  body: string;
}

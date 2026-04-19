import { useRef, useEffect } from 'react';
import type { ObservatoryEvent, EventSeverity } from '../../domain';
import './EventLog.css';

const SEVERITY_TAG: Record<EventSeverity, string> = {
  debug: 'DBG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
};

export interface EventLogProps {
  events: ObservatoryEvent[];
  'data-testid'?: string;
}

export function EventLog({ events, 'data-testid': testId }: EventLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events]);

  return (
    // pointer-events: none lets canvas clicks pass through the wrapper
    <div
      className="obs-event-log"
      style={{ pointerEvents: 'none' }}
      data-testid={testId ?? 'event-log'}
    >
      <div className="obs-event-log__inner" style={{ pointerEvents: 'auto' }} ref={scrollRef}>
        {events.length === 0 ? (
          <span className="obs-event-log__empty">no events</span>
        ) : (
          events.map((ev) => (
            <div
              key={ev.id}
              className="obs-event-log__entry"
              data-severity={ev.severity}
              data-testid={`event-${ev.id}`}
            >
              <span className="obs-event-log__ts">{ev.timestamp.slice(11, 19)}</span>
              <span className="obs-event-log__sev" data-sev={ev.severity}>
                {SEVERITY_TAG[ev.severity]}
              </span>
              <span className="obs-event-log__src">{ev.sourceId}</span>
              <span className="obs-event-log__msg">{ev.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

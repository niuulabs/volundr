import { useRef, useEffect } from 'react';
import { Workflow } from 'lucide-react';
import { MeshEventCard } from '../MeshEventCard';
import type { MeshEvent } from '../../types';
import './MeshCascadePanel.css';

interface MeshCascadePanelProps {
  events: readonly MeshEvent[];
  onEventClick?: (event: MeshEvent) => void;
  className?: string;
}

export function MeshCascadePanel({ events, onEventClick, className }: MeshCascadePanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(events.length);

  useEffect(() => {
    if (events.length > prevCountRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevCountRef.current = events.length;
  }, [events.length]);

  if (events.length === 0) return null;

  const outcomes = events.filter((e) => e.type === 'outcome').length;
  const delegations = events.filter((e) => e.type === 'mesh_message').length;
  const notifications = events.filter((e) => e.type === 'notification').length;

  const latestOutcome = [...events].reverse().find((e) => e.type === 'outcome');
  const latestVerdict = latestOutcome?.type === 'outcome' ? latestOutcome.verdict : undefined;

  return (
    <div
      className={`niuu-chat-cascade-panel${className ? ` ${className}` : ''}`}
      data-testid="mesh-cascade-panel"
    >
      <div className="niuu-chat-cascade-header">
        <div className="niuu-chat-cascade-header-left">
          <Workflow className="niuu-chat-cascade-icon" />
          <span className="niuu-chat-cascade-title">Mesh Cascade</span>
          <span className="niuu-chat-cascade-badge">{events.length}</span>
          {latestVerdict && (
            <span className="niuu-chat-cascade-status-dot" data-verdict={latestVerdict} />
          )}
        </div>
        <div className="niuu-chat-cascade-header-right">
          <span className="niuu-chat-cascade-summary">
            {outcomes > 0 && (
              <span>
                {outcomes} outcome{outcomes !== 1 ? 's' : ''}
              </span>
            )}
            {delegations > 0 && (
              <span>
                {delegations} delegation{delegations !== 1 ? 's' : ''}
              </span>
            )}
            {notifications > 0 && (
              <span>
                {notifications} alert{notifications !== 1 ? 's' : ''}
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="niuu-chat-cascade-content" ref={scrollRef}>
        <div className="niuu-chat-cascade-timeline">
          {events.map((event) => (
            <div
              key={event.id}
              className="niuu-chat-cascade-timeline-item"
              onClick={() => onEventClick?.(event)}
              data-clickable={onEventClick ? true : undefined}
            >
              <div className="niuu-chat-cascade-timeline-line" />
              <MeshEventCard event={event} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

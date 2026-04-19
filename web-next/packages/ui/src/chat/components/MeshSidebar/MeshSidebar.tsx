import { useState } from 'react';
import { cn } from '../../../utils/cn';
import type { RoomParticipant } from '../../types';
import './MeshSidebar.css';

interface MeshSidebarProps {
  participants: ReadonlyMap<string, RoomParticipant>;
  selectedPeerId: string | null;
  onSelectPeer: (peerId: string) => void;
}

interface PeerCardProps {
  participant: RoomParticipant;
  isSelected: boolean;
  onSelect: () => void;
}

function PeerCard({ participant, isSelected, onSelect }: PeerCardProps) {
  const [expanded, setExpanded] = useState(false);

  const hasMetadata =
    (participant.subscribesTo && participant.subscribesTo.length > 0) ||
    (participant.emits && participant.emits.length > 0) ||
    (participant.tools && participant.tools.length > 0);

  return (
    <div
      className={cn('niuu-chat-peer-card', isSelected && 'niuu-chat-peer-card--selected')}
      data-participant-color={participant.color}
      onClick={onSelect}
      data-testid={`peer-card-${participant.peerId}`}
    >
      <div className="niuu-chat-peer-header">
        <span className="niuu-chat-peer-status-dot" data-status={participant.status} />
        <span className="niuu-chat-peer-name">
          {participant.displayName
            ? `${participant.displayName} (${participant.persona})`
            : participant.persona || participant.peerId}
        </span>
        <span className="niuu-chat-peer-status-label">{participant.status}</span>
      </div>

      {hasMetadata && (
        <button
          type="button"
          className="niuu-chat-peer-expand-toggle"
          onClick={e => {
            e.stopPropagation();
            setExpanded(v => !v);
          }}
        >
          {expanded ? 'hide details' : 'show details'}
        </button>
      )}

      {expanded && hasMetadata && (
        <div className="niuu-chat-peer-meta">
          {participant.subscribesTo && participant.subscribesTo.length > 0 && (
            <>
              <span className="niuu-chat-peer-meta-label">Subscribes</span>
              <div className="niuu-chat-peer-meta-tags">
                {participant.subscribesTo.map(evt => (
                  <span key={evt} className="niuu-chat-peer-meta-tag" data-variant="subscribe">{evt}</span>
                ))}
              </div>
            </>
          )}
          {participant.emits && participant.emits.length > 0 && (
            <>
              <span className="niuu-chat-peer-meta-label">Emits</span>
              <div className="niuu-chat-peer-meta-tags">
                {participant.emits.map(evt => (
                  <span key={evt} className="niuu-chat-peer-meta-tag" data-variant="emit">{evt}</span>
                ))}
              </div>
            </>
          )}
          {participant.tools && participant.tools.length > 0 && (
            <>
              <span className="niuu-chat-peer-meta-label">Tools</span>
              <div className="niuu-chat-peer-meta-tags">
                {participant.tools.map(tool => (
                  <span key={tool} className="niuu-chat-peer-meta-tag" data-variant="tool">{tool}</span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function MeshSidebar({ participants, selectedPeerId, onSelectPeer }: MeshSidebarProps) {
  const peers = Array.from(participants.values()).filter(p => p.participantType === 'ravn');

  if (peers.length === 0) return null;

  return (
    <aside className="niuu-chat-mesh-sidebar" data-testid="mesh-sidebar">
      <div className="niuu-chat-mesh-sidebar-header">
        <span className="niuu-chat-mesh-sidebar-title">Mesh Peers</span>
        <span className="niuu-chat-mesh-sidebar-count">{peers.length}</span>
      </div>
      <div className="niuu-chat-mesh-sidebar-peer-list">
        {peers.map(peer => (
          <PeerCard
            key={peer.peerId}
            participant={peer}
            isSelected={selectedPeerId === peer.peerId}
            onSelect={() => onSelectPeer(peer.peerId)}
          />
        ))}
      </div>
    </aside>
  );
}

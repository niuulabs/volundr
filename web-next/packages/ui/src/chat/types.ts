// All types copied/adapted from web/src/modules/shared/hooks/useSkuldChat.ts

export type ChatMessageRole = 'user' | 'assistant' | 'system';

export type SkuldChatMessagePart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'reasoning'; readonly text: string }
  | {
      readonly type: 'tool_use';
      readonly id: string;
      readonly name: string;
      readonly input: Record<string, unknown>;
    }
  | { readonly type: 'tool_result'; readonly tool_use_id: string; readonly content: string };

export interface TextContentBlock {
  readonly type: 'text';
  readonly text: string;
}

export interface ImageContentBlock {
  readonly type: 'image';
  readonly source: {
    readonly type: 'base64';
    readonly media_type: string;
    readonly data: string;
  };
}

export interface DocumentContentBlock {
  readonly type: 'document';
  readonly source: {
    readonly type: 'base64';
    readonly media_type: string;
    readonly data: string;
  };
}

export type ContentBlock = TextContentBlock | ImageContentBlock | DocumentContentBlock;

export interface AttachmentMeta {
  readonly name: string;
  readonly type: 'image' | 'document' | 'text';
  readonly size: number;
  readonly contentType: string;
}

export interface ChatMessageMeta {
  messageType?: 'system';
  systemSubtype?: string;
  usage?: Record<
    string,
    {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
      costUSD?: number;
    }
  >;
  cost?: number;
  turns?: number;
}

export interface ParticipantMeta {
  readonly peerId: string;
  readonly persona: string;
  readonly displayName: string;
  readonly color: string;
  readonly participantType: 'human' | 'ravn';
  readonly gatewayUrl?: string;
  readonly subscribesTo?: readonly string[];
  readonly emits?: readonly string[];
  readonly tools?: readonly string[];
}

export interface SkuldChatMessage {
  readonly id: string;
  readonly role: ChatMessageRole;
  readonly content: string;
  readonly parts?: readonly SkuldChatMessagePart[];
  readonly attachments?: readonly AttachmentMeta[];
  readonly createdAt: Date;
  readonly status: 'running' | 'complete' | 'error';
  readonly metadata?: ChatMessageMeta;
  readonly participantId?: string;
  readonly participant?: ParticipantMeta;
  readonly threadId?: string;
  readonly visibility?: string;
}

export type PermissionBehavior = 'allow' | 'deny' | 'allowForever';

export interface PermissionRequest {
  readonly request_id: string;
  readonly controlType: string;
  readonly tool: string;
  readonly input: Record<string, unknown>;
  readonly receivedAt: Date;
}

export type ParticipantStatus = 'idle' | 'busy' | 'thinking' | 'tool_executing';

export interface RoomParticipant extends ParticipantMeta {
  readonly status: ParticipantStatus;
  readonly joinedAt: Date;
}

export type MeshEventType = 'outcome' | 'mesh_message' | 'notification';

export interface MeshOutcomeEvent {
  readonly type: 'outcome';
  readonly id: string;
  readonly timestamp: Date;
  readonly participantId: string;
  readonly participant: ParticipantMeta;
  readonly persona: string;
  readonly eventType: string;
  readonly fields: Record<string, unknown>;
  readonly valid: boolean;
  readonly summary?: string;
  readonly verdict?: string;
}

export interface MeshDelegationEvent {
  readonly type: 'mesh_message';
  readonly id: string;
  readonly timestamp: Date;
  readonly participantId: string;
  readonly participant: ParticipantMeta;
  readonly fromPersona: string;
  readonly eventType: string;
  readonly direction: 'delegate' | 'receive';
  readonly preview: string;
}

export interface MeshNotificationEvent {
  readonly type: 'notification';
  readonly id: string;
  readonly timestamp: Date;
  readonly participantId: string;
  readonly participant: ParticipantMeta;
  readonly notificationType: string;
  readonly persona: string;
  readonly reason: string;
  readonly summary: string;
  readonly attempted?: string[];
  readonly recommendation?: string;
  readonly urgency: number;
  readonly context?: Record<string, unknown>;
}

export type MeshEvent = MeshOutcomeEvent | MeshDelegationEvent | MeshNotificationEvent;

export interface AgentInternalEvent {
  readonly id: string;
  readonly participantId: string;
  readonly timestamp: Date;
  readonly frameType: string;
  readonly data: unknown;
  readonly metadata: Record<string, unknown>;
}

export interface TransportCapabilities {
  readonly send_message: boolean;
  readonly cli_websocket: boolean;
  readonly session_resume: boolean;
  readonly interrupt: boolean;
  readonly set_model: boolean;
  readonly set_thinking_tokens: boolean;
  readonly set_permission_mode: boolean;
  readonly rewind_files: boolean;
  readonly mcp_set_servers: boolean;
  readonly permission_requests: boolean;
  readonly slash_commands: boolean;
  readonly skills: boolean;
}

export const DEFAULT_CAPABILITIES: TransportCapabilities = {
  send_message: true,
  cli_websocket: false,
  session_resume: false,
  interrupt: false,
  set_model: false,
  set_thinking_tokens: false,
  set_permission_mode: false,
  rewind_files: false,
  mcp_set_servers: false,
  permission_requests: false,
  slash_commands: false,
  skills: false,
};

/** File tree entry returned by the Skuld /api/files endpoint */
export interface FileTreeEntry {
  readonly name: string;
  readonly path: string;
  readonly type: 'file' | 'directory';
}

export interface SlashCommand {
  name: string;
  type: 'command' | 'skill';
  description?: string;
}

/** Session state injected into SessionChat as props (replaces useSkuldChat hook) */
export interface SessionChatSession {
  messages: readonly SkuldChatMessage[];
  participants: ReadonlyMap<string, RoomParticipant>;
  meshEvents: readonly MeshEvent[];
  agentEvents: ReadonlyMap<string, readonly AgentInternalEvent[]>;
  connected: boolean;
  isRunning: boolean;
  historyLoaded: boolean;
  pendingPermissions: readonly PermissionRequest[];
  availableCommands: readonly SlashCommand[];
  capabilities: TransportCapabilities;
  sessionId?: string;
  sendMessage: (
    text: string,
    attachments?: ContentBlock[],
    attachmentMeta?: AttachmentMeta[]
  ) => void;
  /** Send a message directed at specific participants (room mode) */
  sendDirectedMessages?: (peerIds: string[], text: string) => void;
  /** Interrupt a running assistant turn */
  sendInterrupt?: () => void;
  /** Send a model switch request */
  sendSetModel?: (model: string) => void;
  /** Send a thinking-token budget update */
  sendSetMaxThinkingTokens?: (tokens: number) => void;
  /** Rewind files to their pre-turn state */
  sendRewindFiles?: () => void;
  /** Clear the local message list */
  clearMessages?: () => void;
  interrupt: () => void;
  respondToPermission: (requestId: string, behavior: PermissionBehavior) => void;
}

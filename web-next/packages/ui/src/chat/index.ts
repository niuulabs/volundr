// ── Types ─────────────────────────────────────────────────
export type {
  ChatMessageRole,
  SkuldChatMessagePart,
  TextContentBlock,
  ImageContentBlock,
  DocumentContentBlock,
  ContentBlock,
  AttachmentMeta,
  ChatMessageMeta,
  ParticipantMeta,
  SkuldChatMessage,
  PermissionBehavior,
  PermissionRequest,
  ParticipantStatus,
  RoomParticipant,
  MeshEventType,
  MeshOutcomeEvent,
  MeshDelegationEvent,
  MeshNotificationEvent,
  MeshEvent,
  AgentInternalEvent,
  TransportCapabilities,
  FileTreeEntry,
  SlashCommand,
  SessionChatSession,
} from './types';
export { DEFAULT_CAPABILITIES } from './types';

// ── Hooks ─────────────────────────────────────────────────
export { useSpeechRecognition } from './hooks/useSpeechRecognition';
export { useSlashMenu } from './hooks/useSlashMenu';
export { useMentionMenu } from './hooks/useMentionMenu';
export type { SelectedMention, MentionItem } from './hooks/useMentionMenu';
export { useFileAttachments } from './hooks/useFileAttachments';
export type { FileAttachment } from './hooks/useFileAttachments';
export { useRoomState } from './hooks/useRoomState';

// ── Slash Commands ─────────────────────────────────────────
export { buildCommandList } from './slashCommands';

// ── Utils ──────────────────────────────────────────────────
export { resolveParticipantColor, participantSlot, PARTICIPANT_SLOT_COUNT, PARTICIPANT_COLOR_MAP } from './utils/participantColor';
export { compressImage } from './utils/compressImage';

// ── Components ─────────────────────────────────────────────
export { SessionChat } from './SessionChat';
export type { SessionChatProps } from './SessionChat';

export { ChatInput } from './ChatInput';

export {
  UserMessage,
  AssistantMessage,
  StreamingMessage,
  SystemMessage,
} from './ChatMessages';

export { SessionEmptyChat } from './ChatEmptyStates';

export { MarkdownContent } from './MarkdownContent';
export { RenderedContent, CodeBlock } from './RenderedContent';

export { SlashCommandMenu } from './SlashCommandMenu';
export { MentionMenu } from './MentionMenu';
export { MentionPill } from './MentionPill';

export { FilterTabs } from './FilterTabs';
export type { FilterTabsProps } from './FilterTabs';

export { ParticipantFilter } from './ParticipantFilter';
export { RoomMessage } from './RoomMessage';
export { ThreadGroup } from './ThreadGroup';

export { MeshEventCard } from './MeshEventCard';
export { MeshCascadePanel } from './MeshCascadePanel';
export { MeshSidebar } from './MeshSidebar';
export { AgentDetailPanel } from './AgentDetailPanel';

export { OutcomeCard, OUTCOME_RE, OUTCOME_EXTRACT_RE, parseOutcomeFields } from './OutcomeCard';

export {
  ToolBlock,
  ToolGroupBlock,
  ToolIcon,
  getToolLabel,
  groupContentBlocks,
} from './ToolBlock';

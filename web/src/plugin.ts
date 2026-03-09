/**
 * @niuu/volundr-ui — Library entry point
 *
 * When consumed as a package (e.g. from Hlidskjalf), import from here:
 *   import { VolundrPage, useVolundr } from '@niuu/volundr-ui';
 *   import '@niuu/volundr-ui/styles';
 */

// Pages
export { VolundrPage } from '@/pages/Volundr';
export { VolundrPopout } from '@/pages/Volundr/VolundrPopout';

// Core hooks
export { useVolundr } from '@/hooks/useVolundr';
export { useLocalStorage } from '@/hooks/useLocalStorage';
export { useBroadcastChannel } from '@/hooks/useBroadcastChannel';
export { useWebSocket } from '@/hooks/useWebSocket';
export type { WebSocketStatus } from '@/hooks/useWebSocket';
export { useSessionProbe } from '@/hooks/useSessionStartingPoll';
export { useSkuldChat } from '@/hooks/useSkuldChat';
export type { SkuldChatMessage, ChatMessageMeta, ChatMessageRole } from '@/hooks/useSkuldChat';
export { useDiffViewer } from '@/hooks/useDiffViewer';
export type { UseDiffViewerResult } from '@/hooks/useDiffViewer';

// Components
export { SessionChat } from '@/components/SessionChat';
export { SessionTerminal } from '@/components/SessionTerminal';
export { SessionChronicles } from '@/components/SessionChronicles';
export type { SessionChroniclesProps } from '@/components/SessionChronicles';
export { SessionCard } from '@/components/organisms/SessionCard';
export type { SessionCardProps } from '@/components/organisms/SessionCard';
export { LaunchWizard } from '@/components/LaunchWizard';
export type { LaunchWizardProps, LaunchConfig } from '@/components/LaunchWizard';
export { Modal } from '@/components/organisms/Modal';
export type { ModalProps } from '@/components/organisms/Modal';
export { SessionGroupList } from '@/components/SessionGroupList';
export { DiffViewer } from '@/components/DiffViewer';
export { FileChangeList } from '@/components/FileChangeList';
export { ContextSidebar } from '@/components/ContextSidebar';
export type { ContextSidebarProps } from '@/components/ContextSidebar';

// Models & types
export type {
  VolundrSession,
  VolundrStats,
  VolundrModel,
  VolundrRepo,
  VolundrTemplate,
  VolundrLog,
  SessionChronicle,
  VolundrPreset,
} from '@/models/volundr.model';

// Ports (interfaces)
export type { IVolundrService } from '@/ports/volundr.port';

// Adapters
export { MockVolundrService } from '@/adapters/mock/volundr.adapter';
export { ApiVolundrService } from '@/adapters/api/volundr.adapter';

// Utilities
export { cn } from '@/utils/classnames';
export { formatTokens, formatNumber, formatBytes } from '@/utils/formatters';

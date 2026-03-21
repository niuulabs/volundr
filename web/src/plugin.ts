/**
 * @niuu/volundr-ui — Library entry point
 *
 * When consumed as a package (e.g. from Hlidskjalf), import from here:
 *   import { VolundrPage, useVolundr } from '@niuu/volundr-ui';
 *   import '@niuu/volundr-ui/styles';
 */

// Pages
export { VolundrPage } from '@/modules/volundr/pages/Volundr';
export { VolundrPopout } from '@/modules/volundr/pages/Volundr/VolundrPopout';

// Core hooks
export { useVolundr } from '@/modules/volundr/hooks/useVolundr';
export { useLocalStorage } from '@/hooks/useLocalStorage';
export { useBroadcastChannel } from '@/hooks/useBroadcastChannel';
export { useWebSocket } from '@/hooks/useWebSocket';
export type { WebSocketStatus } from '@/hooks/useWebSocket';
export { useSessionProbe } from '@/modules/volundr/hooks/useSessionStartingPoll';
export { useSkuldChat } from '@/modules/volundr/hooks/useSkuldChat';
export type {
  SkuldChatMessage,
  ChatMessageMeta,
  ChatMessageRole,
} from '@/modules/volundr/hooks/useSkuldChat';
export { useDiffViewer } from '@/modules/volundr/hooks/useDiffViewer';
export type { UseDiffViewerResult } from '@/modules/volundr/hooks/useDiffViewer';

// Components
export { SessionChat } from '@/modules/volundr/components/SessionChat';
export { SessionTerminal } from '@/modules/volundr/components/SessionTerminal';
export { SessionChronicles } from '@/modules/volundr/components/SessionChronicles';
export type { SessionChroniclesProps } from '@/modules/volundr/components/SessionChronicles';
export { SessionCard } from '@/modules/volundr/components/organisms/SessionCard';
export type { SessionCardProps } from '@/modules/volundr/components/organisms/SessionCard';
export { LaunchWizard } from '@/modules/volundr/components/LaunchWizard';
export type { LaunchWizardProps, LaunchConfig } from '@/modules/volundr/components/LaunchWizard';
export { Modal } from '@/modules/shared/components/Modal';
export type { ModalProps } from '@/modules/shared/components/Modal';
export { SessionGroupList } from '@/modules/volundr/components/SessionGroupList';
export { DiffViewer } from '@/modules/volundr/components/DiffViewer';
export { FileChangeList } from '@/modules/volundr/components/FileChangeList';
export { ContextSidebar } from '@/modules/volundr/components/ContextSidebar';
export type { ContextSidebarProps } from '@/modules/volundr/components/ContextSidebar';

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
} from '@/modules/volundr/models/volundr.model';

// Ports (interfaces)
export type { IVolundrService } from '@/modules/volundr/ports/volundr.port';

// Adapters
export { MockVolundrService } from '@/modules/volundr/adapters/mock/volundr.adapter';
export { ApiVolundrService } from '@/modules/volundr/adapters/api/volundr.adapter';

// Utilities
export { cn } from '@/modules/shared/utils/classnames';
export { formatTokens, formatNumber, formatBytes } from '@/utils/formatters';

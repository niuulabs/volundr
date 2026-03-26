import {
  Terminal,
  FileText,
  FilePlus,
  FileEdit,
  Search,
  Globe,
  Bot,
  ListChecks,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

const TOOL_ICON_MAP: Record<string, LucideIcon> = {
  Bash: Terminal,
  Read: FileText,
  Write: FilePlus,
  Edit: FileEdit,
  Glob: Search,
  Grep: Search,
  WebSearch: Globe,
  WebFetch: Globe,
  Agent: Bot,
  TaskCreate: ListChecks,
  TaskUpdate: ListChecks,
  TodoWrite: ListChecks,
};

interface ToolIconProps {
  toolName: string;
  className?: string;
}

export function ToolIcon({ toolName, className }: ToolIconProps) {
  const Icon = TOOL_ICON_MAP[toolName] ?? Wrench;
  return <Icon className={className} />;
}

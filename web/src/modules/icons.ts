/**
 * Maps icon name strings (from backend config) to lucide-react icon components.
 *
 * Add new icons here as new feature modules are created.
 */
import {
  Users,
  Building2,
  HardDrive,
  Cpu,
  KeyRound,
  Link2,
  Palette,
  ToggleLeft,
  LayoutDashboard,
  Settings,
  MessageSquare,
  Terminal,
  Code,
  FolderOpen,
  GitCompareArrows,
  ScrollText,
  FileText,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const iconMap: Record<string, LucideIcon> = {
  Users,
  Building2,
  HardDrive,
  Cpu,
  KeyRound,
  Link2,
  Palette,
  ToggleLeft,
  LayoutDashboard,
  Settings,
  MessageSquare,
  Terminal,
  Code,
  FolderOpen,
  GitCompareArrows,
  ScrollText,
  FileText,
};

export function resolveIcon(name: string): LucideIcon | undefined {
  return iconMap[name];
}

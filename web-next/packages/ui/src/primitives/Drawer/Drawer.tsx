import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';
import './Drawer.css';

export type DrawerSide = 'right' | 'left';

const DRAWER_DEFAULT_WIDTH = 360;

export interface DrawerProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

export interface DrawerTriggerProps {
  children: ReactNode;
  asChild?: boolean;
}

export interface DrawerContentProps {
  children: ReactNode;
  className?: string;
  /** Which side the drawer slides in from */
  side?: DrawerSide;
  /** Width in pixels */
  width?: number;
  /** Accessible title (required for a11y) */
  title: string;
  /** Optional description */
  description?: string;
}

export interface DrawerHeaderProps {
  children: ReactNode;
  className?: string;
}

export interface DrawerFooterProps {
  children: ReactNode;
  className?: string;
}

export interface DrawerCloseProps {
  children?: ReactNode;
  asChild?: boolean;
  className?: string;
}

export function Drawer({ open, onOpenChange, children }: DrawerProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </RadixDialog.Root>
  );
}

export function DrawerTrigger({ children, asChild }: DrawerTriggerProps) {
  return <RadixDialog.Trigger asChild={asChild}>{children}</RadixDialog.Trigger>;
}

export function DrawerContent({
  children,
  className,
  side = 'right',
  width = DRAWER_DEFAULT_WIDTH,
  title,
  description,
}: DrawerContentProps) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="niuu-drawer__overlay" />
      <RadixDialog.Content
        className={cn('niuu-drawer__content', `niuu-drawer__content--${side}`, className)}
        style={{ width }}
      >
        <RadixDialog.Title className="niuu-drawer__title">{title}</RadixDialog.Title>
        {description && (
          <RadixDialog.Description className="niuu-drawer__description">
            {description}
          </RadixDialog.Description>
        )}
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

export function DrawerHeader({ children, className }: DrawerHeaderProps) {
  return <div className={cn('niuu-drawer__header', className)}>{children}</div>;
}

export function DrawerFooter({ children, className }: DrawerFooterProps) {
  return <div className={cn('niuu-drawer__footer', className)}>{children}</div>;
}

export function DrawerClose({ children, asChild, className }: DrawerCloseProps) {
  return (
    <RadixDialog.Close asChild={asChild} className={cn('niuu-drawer__close', className)}>
      {children ?? '✕'}
    </RadixDialog.Close>
  );
}

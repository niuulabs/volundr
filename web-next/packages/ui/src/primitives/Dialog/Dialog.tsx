import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';
import './Dialog.css';

export interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

export interface DialogTriggerProps {
  children: ReactNode;
  asChild?: boolean;
}

export interface DialogContentProps {
  children: ReactNode;
  className?: string;
  /** Accessible title (required for a11y) */
  title: string;
  /** Optional description shown below the title */
  description?: string;
}

export interface DialogHeaderProps {
  children: ReactNode;
  className?: string;
}

export interface DialogFooterProps {
  children: ReactNode;
  className?: string;
}

export interface DialogCloseProps {
  children?: ReactNode;
  asChild?: boolean;
  className?: string;
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </RadixDialog.Root>
  );
}

export function DialogTrigger({ children, asChild }: DialogTriggerProps) {
  return <RadixDialog.Trigger asChild={asChild}>{children}</RadixDialog.Trigger>;
}

export function DialogContent({ children, className, title, description }: DialogContentProps) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="niuu-dialog__overlay" />
      <RadixDialog.Content className={cn('niuu-dialog__content', className)}>
        <RadixDialog.Title className="niuu-dialog__title">{title}</RadixDialog.Title>
        {description && (
          <RadixDialog.Description className="niuu-dialog__description">
            {description}
          </RadixDialog.Description>
        )}
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

export function DialogHeader({ children, className }: DialogHeaderProps) {
  return <div className={cn('niuu-dialog__header', className)}>{children}</div>;
}

export function DialogFooter({ children, className }: DialogFooterProps) {
  return <div className={cn('niuu-dialog__footer', className)}>{children}</div>;
}

export function DialogClose({ children, asChild, className }: DialogCloseProps) {
  return (
    <RadixDialog.Close asChild={asChild} className={cn('niuu-dialog__close', className)}>
      {children ?? '✕'}
    </RadixDialog.Close>
  );
}

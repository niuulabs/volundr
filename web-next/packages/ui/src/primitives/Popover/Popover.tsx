import * as RadixPopover from '@radix-ui/react-popover';
import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';
import './Popover.css';

export type PopoverSide = 'top' | 'right' | 'bottom' | 'left';
export type PopoverAlign = 'start' | 'center' | 'end';

export interface PopoverProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

export interface PopoverTriggerProps {
  children: ReactNode;
  asChild?: boolean;
}

export interface PopoverContentProps {
  children: ReactNode;
  className?: string;
  side?: PopoverSide;
  align?: PopoverAlign;
  sideOffset?: number;
}

export interface PopoverCloseProps {
  children?: ReactNode;
  asChild?: boolean;
  className?: string;
}

export function Popover({ open, onOpenChange, children }: PopoverProps) {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </RadixPopover.Root>
  );
}

export function PopoverTrigger({ children, asChild }: PopoverTriggerProps) {
  return <RadixPopover.Trigger asChild={asChild}>{children}</RadixPopover.Trigger>;
}

export function PopoverContent({
  children,
  className,
  side = 'bottom',
  align = 'center',
  sideOffset = 8,
}: PopoverContentProps) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        className={cn('niuu-popover__content', className)}
        side={side}
        align={align}
        sideOffset={sideOffset}
      >
        {children}
        <RadixPopover.Arrow className="niuu-popover__arrow" />
      </RadixPopover.Content>
    </RadixPopover.Portal>
  );
}

export function PopoverClose({ children, asChild, className }: PopoverCloseProps) {
  return (
    <RadixPopover.Close asChild={asChild} className={cn('niuu-popover__close', className)}>
      {children ?? '✕'}
    </RadixPopover.Close>
  );
}

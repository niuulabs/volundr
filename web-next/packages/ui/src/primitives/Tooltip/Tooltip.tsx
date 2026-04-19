import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';
import './Tooltip.css';

export type TooltipSide = 'top' | 'right' | 'bottom' | 'left';

export interface TooltipProviderProps {
  children: ReactNode;
  /** Delay in ms before tooltip shows */
  delayDuration?: number;
}

export interface TooltipProps {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export interface TooltipTriggerProps {
  children: ReactNode;
  asChild?: boolean;
}

export interface TooltipContentProps {
  children: ReactNode;
  className?: string;
  side?: TooltipSide;
  sideOffset?: number;
}

const TOOLTIP_DELAY_MS = 400;

export function TooltipProvider({
  children,
  delayDuration = TOOLTIP_DELAY_MS,
}: TooltipProviderProps) {
  return <RadixTooltip.Provider delayDuration={delayDuration}>{children}</RadixTooltip.Provider>;
}

export function Tooltip({ children, open, onOpenChange }: TooltipProps) {
  return (
    <RadixTooltip.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </RadixTooltip.Root>
  );
}

export function TooltipTrigger({ children, asChild }: TooltipTriggerProps) {
  return <RadixTooltip.Trigger asChild={asChild}>{children}</RadixTooltip.Trigger>;
}

export function TooltipContent({
  children,
  className,
  side = 'top',
  sideOffset = 6,
}: TooltipContentProps) {
  return (
    <RadixTooltip.Portal>
      <RadixTooltip.Content
        className={cn('niuu-tooltip__content', className)}
        side={side}
        sideOffset={sideOffset}
      >
        {children}
        <RadixTooltip.Arrow className="niuu-tooltip__arrow" />
      </RadixTooltip.Content>
    </RadixTooltip.Portal>
  );
}

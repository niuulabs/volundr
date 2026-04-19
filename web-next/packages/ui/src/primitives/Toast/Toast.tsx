import * as RadixToast from '@radix-ui/react-toast';
import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';
import './Toast.css';

export type ToastVariant = 'default' | 'success' | 'error' | 'warning';

export interface ToastProviderProps {
  children: ReactNode;
  /** Duration in ms before toast auto-dismisses. 0 = never */
  duration?: number;
  swipeDirection?: 'right' | 'left' | 'up' | 'down';
}

export interface ToastProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  variant?: ToastVariant;
  duration?: number;
  children: ReactNode;
  className?: string;
}

export interface ToastTitleProps {
  children: ReactNode;
  className?: string;
}

export interface ToastDescriptionProps {
  children: ReactNode;
  className?: string;
}

export interface ToastActionProps {
  children: ReactNode;
  altText: string;
  className?: string;
}

export interface ToastCloseProps {
  children?: ReactNode;
  className?: string;
}

export interface ToastViewportProps {
  className?: string;
}

const TOAST_DEFAULT_DURATION_MS = 5000;

export function ToastProvider({
  children,
  duration = TOAST_DEFAULT_DURATION_MS,
  swipeDirection = 'right',
}: ToastProviderProps) {
  return (
    <RadixToast.Provider duration={duration} swipeDirection={swipeDirection}>
      {children}
      <ToastViewport />
    </RadixToast.Provider>
  );
}

export function Toast({
  open,
  onOpenChange,
  variant = 'default',
  duration,
  children,
  className,
}: ToastProps) {
  return (
    <RadixToast.Root
      open={open}
      onOpenChange={onOpenChange}
      duration={duration}
      className={cn('niuu-toast', `niuu-toast--${variant}`, className)}
    >
      {children}
    </RadixToast.Root>
  );
}

export function ToastTitle({ children, className }: ToastTitleProps) {
  return (
    <RadixToast.Title className={cn('niuu-toast__title', className)}>{children}</RadixToast.Title>
  );
}

export function ToastDescription({ children, className }: ToastDescriptionProps) {
  return (
    <RadixToast.Description className={cn('niuu-toast__description', className)}>
      {children}
    </RadixToast.Description>
  );
}

export function ToastAction({ children, altText, className }: ToastActionProps) {
  return (
    <RadixToast.Action altText={altText} className={cn('niuu-toast__action', className)}>
      {children}
    </RadixToast.Action>
  );
}

export function ToastClose({ children, className }: ToastCloseProps) {
  return (
    <RadixToast.Close className={cn('niuu-toast__close', className)}>
      {children ?? '✕'}
    </RadixToast.Close>
  );
}

export function ToastViewport({ className }: ToastViewportProps) {
  return <RadixToast.Viewport className={cn('niuu-toast__viewport', className)} />;
}

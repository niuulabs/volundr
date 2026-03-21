import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combines class names conditionally with Tailwind merge support.
 *
 * Handles CSS module classes, Tailwind utilities, and conditional values.
 * tailwind-merge deduplicates conflicting Tailwind classes (e.g. `p-2 p-4` → `p-4`).
 *
 * @example
 * cn(styles.button, styles[variant], disabled && styles.disabled)
 * cn("bg-muted text-sm", isActive && "bg-accent")
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

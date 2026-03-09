import type { DiffBase } from '@/models';
import { cn } from '@/utils';
import styles from './DiffBaseToggle.module.css';

export interface DiffBaseToggleProps {
  value: DiffBase;
  onChange: (base: DiffBase) => void;
  className?: string;
}

const OPTIONS: { value: DiffBase; label: string }[] = [
  { value: 'last-commit', label: 'Last Commit' },
  { value: 'default-branch', label: 'Default Branch' },
];

export function DiffBaseToggle({ value, onChange, className }: DiffBaseToggleProps) {
  return (
    <div className={cn(styles.toggle, className)}>
      {OPTIONS.map(opt => (
        <button
          key={opt.value}
          type="button"
          className={cn(styles.option, value === opt.value && styles.optionActive)}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

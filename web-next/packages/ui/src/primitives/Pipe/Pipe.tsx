import { cn } from '../../utils/cn';
import './Pipe.css';

export type PipePhaseStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface PipePhase {
  status: PipePhaseStatus;
  /** Optional label for the phase, used as accessible title. */
  label?: string;
}

export interface PipeProps {
  phases: PipePhase[];
  className?: string;
}

export function Pipe({ phases, className }: PipeProps) {
  return (
    <span className={cn('niuu-pipe', className)} aria-label="phase progress">
      {phases.map((phase, i) => (
        <span
          key={i}
          className={cn('niuu-pipe__cell', `niuu-pipe__cell--${phase.status}`)}
          title={phase.label ?? phase.status}
          aria-label={phase.label ?? phase.status}
        />
      ))}
    </span>
  );
}

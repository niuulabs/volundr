import { PersonaAvatar } from '@niuulabs/ui';
import type { PersonaRole } from '@niuulabs/domain';

const FLOCK_PERSONAS: Array<{ role: PersonaRole; label: string }> = [
  { role: 'plan', label: 'Decomposer' },
  { role: 'build', label: 'Coding Agent' },
  { role: 'verify', label: 'QA Agent' },
  { role: 'review', label: 'Reviewer' },
  { role: 'ship', label: 'Ship Agent' },
];

const DEFAULT_WORKFLOW = 'ship';
const DEFAULT_VERSION = '1.0.0';

interface WorkflowCardProps {
  workflow?: string;
  workflowVersion?: string;
}

export function WorkflowCard({ workflow, workflowVersion }: WorkflowCardProps) {
  const name = workflow ?? DEFAULT_WORKFLOW;
  const version = workflowVersion ?? DEFAULT_VERSION;

  return (
    <section
      aria-label="Workflow"
      className="niuu-rounded-lg niuu-border niuu-border-border niuu-bg-bg-secondary niuu-overflow-hidden"
    >
      <div className="niuu-flex niuu-items-center niuu-justify-between niuu-px-4 niuu-py-3 niuu-border-b niuu-border-border">
        <h3 className="niuu-m-0 niuu-text-sm niuu-font-semibold niuu-text-text-primary">
          Workflow
        </h3>
        <span className="niuu-text-xs niuu-font-mono niuu-text-text-muted niuu-bg-bg-elevated niuu-px-1.5 niuu-py-0.5 niuu-rounded">
          v{version}
        </span>
      </div>

      <div className="niuu-p-4 niuu-space-y-3">
        <div>
          <div className="niuu-text-xs niuu-font-mono niuu-text-text-muted niuu-uppercase niuu-tracking-wide niuu-mb-1">
            APPLIED · PER-SAGA
          </div>
          <div className="niuu-text-sm niuu-font-medium niuu-text-text-primary niuu-mb-1">
            {name} — default release cycle
          </div>
          <p className="niuu-m-0 niuu-text-xs niuu-text-text-secondary">
            qa → pre-ship review → version bump → release PR.
          </p>
        </div>

        <div className="niuu-flex niuu-items-start niuu-gap-2 niuu-rounded niuu-border niuu-border-border niuu-bg-bg-tertiary niuu-px-3 niuu-py-2 niuu-text-xs niuu-text-text-secondary">
          <span className="niuu-shrink-0" aria-hidden="true">
            ⓘ
          </span>
          <span>
            Override this workflow per-dispatch from the Dispatch view. The saga's workflow is the
            default; overrides apply only to that run.
          </span>
        </div>

        <div>
          <div className="niuu-text-xs niuu-font-mono niuu-text-text-muted niuu-uppercase niuu-tracking-wide niuu-mb-2">
            FLOCK
          </div>
          <div
            className="niuu-flex niuu-flex-wrap niuu-gap-2"
            aria-label="Workflow participants"
          >
            {FLOCK_PERSONAS.map(({ role, label }) => (
              <span
                key={role}
                className="niuu-flex niuu-items-center niuu-gap-1 niuu-text-xs niuu-text-text-secondary niuu-bg-bg-elevated niuu-px-2 niuu-py-1 niuu-rounded-full"
              >
                <PersonaAvatar role={role} letter={label.charAt(0)} size={14} title={label} />
                <span>{label}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

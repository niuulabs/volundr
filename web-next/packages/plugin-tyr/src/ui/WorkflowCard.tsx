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
      className="niuu-rounded-xl niuu-border niuu-border-border-subtle niuu-bg-bg-secondary niuu-overflow-hidden"
    >
      <div className="niuu-flex niuu-items-center niuu-justify-between niuu-px-5 niuu-py-4 niuu-border-b niuu-border-border-subtle">
        <h3 className="niuu-m-0 niuu-text-[17px] niuu-font-semibold niuu-text-text-primary">
          Workflow
        </h3>
        <div className="niuu-flex niuu-items-center niuu-gap-2">
          <span className="niuu-rounded-full niuu-bg-bg-elevated niuu-px-2.5 niuu-py-1 niuu-text-[12px] niuu-font-mono niuu-text-text-muted">
            v{version}
          </span>
          <button
            type="button"
            className="niuu-text-[18px] niuu-leading-none niuu-text-text-muted hover:niuu-text-text-primary"
            aria-label="Workflow options"
          >
            …
          </button>
        </div>
      </div>

      <div className="niuu-p-5 niuu-space-y-4">
        <div>
          <div className="niuu-mb-1 niuu-text-[11px] niuu-font-mono niuu-uppercase niuu-tracking-[0.12em] niuu-text-text-muted">
            APPLIED · PER-SAGA
          </div>
          <div className="niuu-mb-1 niuu-text-[15px] niuu-font-semibold niuu-text-text-primary">
            {name} — default release cycle
          </div>
          <p className="niuu-m-0 niuu-text-[13px] niuu-leading-6 niuu-text-text-secondary">
            qa → pre-ship review → version bump → release PR.
          </p>
        </div>

        <div className="niuu-flex niuu-items-start niuu-gap-3 niuu-rounded-lg niuu-border niuu-border-brand/25 niuu-bg-[#1d2630] niuu-px-4 niuu-py-3 niuu-text-[13px] niuu-leading-6 niuu-text-text-secondary">
          <span
            className="niuu-mt-0.5 niuu-inline-flex niuu-w-5 niuu-h-5 niuu-items-center niuu-justify-center niuu-rounded-full niuu-bg-brand niuu-text-[12px] niuu-font-semibold niuu-text-bg-primary"
            aria-hidden="true"
          >
            i
          </span>
          <span>
            Override this workflow per-dispatch from the{' '}
            <span className="niuu-underline">Dispatch</span> view. The saga&apos;s workflow is the
            default; overrides apply only to that run.
          </span>
        </div>

        <div className="niuu-border-t niuu-border-border-subtle niuu-pt-4">
          <div className="niuu-mb-3 niuu-text-[11px] niuu-font-mono niuu-uppercase niuu-tracking-[0.12em] niuu-text-text-muted">
            FLOCK
          </div>
          <div className="niuu-flex niuu-flex-wrap niuu-gap-2" aria-label="Workflow participants">
            {FLOCK_PERSONAS.map(({ role, label }) => (
              <span
                key={role}
                className="niuu-flex niuu-items-center niuu-gap-1.5 niuu-rounded-full niuu-bg-bg-elevated niuu-px-3 niuu-py-1.5 niuu-text-[13px] niuu-text-text-secondary"
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

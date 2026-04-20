import { useState, useEffect } from 'react';
import { Dialog, DialogContent, Field, Input } from '@niuulabs/ui';
import { useTemplates } from './useTemplates';
import type { Template } from '../domain/template';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WizardStep = 'template' | 'source' | 'runtime' | 'confirm' | 'booting';

interface WizardForm {
  templateId: string;
  sourcetype: 'git' | 'local_mount' | 'blank';
  repo: string;
  branch: string;
  mountPath: string;
  sessionName: string;
  cli: string;
  model: string;
  permission: string;
  cpu: string;
  mem: string;
  gpu: string;
  cluster: string;
}

const STEPS: WizardStep[] = ['template', 'source', 'runtime', 'confirm'];

const STEP_LABELS: Record<string, string> = {
  template: 'Template',
  source: 'Source',
  runtime: 'Runtime',
  confirm: 'Confirm',
};

const CLI_OPTIONS = [
  { id: 'claude', label: 'Claude Code', rune: '\u16D7' },
  { id: 'codex', label: 'Codex', rune: '\u16B2' },
  { id: 'gemini', label: 'Gemini', rune: '\u16C7' },
  { id: 'aider', label: 'Aider', rune: '\u16A8' },
];

const BOOT_STEPS = [
  { id: 'schedule', label: 'schedule pod' },
  { id: 'pull', label: 'pull image' },
  { id: 'creds', label: 'check credentials' },
  { id: 'clone', label: 'clone workspace' },
  { id: 'mount', label: 'attach PVCs' },
  { id: 'mcp', label: 'bring MCP servers up' },
  { id: 'cli', label: 'boot CLI tool' },
  { id: 'ready', label: 'ready' },
];

export interface LaunchWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTemplateId?: string;
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepIndicator({ current, steps }: { current: WizardStep; steps: WizardStep[] }) {
  const idx = steps.indexOf(current);
  return (
    <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-py-4" data-testid="step-indicator">
      {steps.map((step, i) => (
        <div key={step} className="niuu-flex niuu-items-center niuu-gap-2">
          <div
            className={`niuu-flex niuu-h-6 niuu-w-6 niuu-items-center niuu-justify-center niuu-rounded-full niuu-font-mono niuu-text-xs ${
              i < idx
                ? 'niuu-bg-brand niuu-text-bg-primary'
                : i === idx
                  ? 'niuu-border-2 niuu-border-brand niuu-text-brand'
                  : 'niuu-border niuu-border-border-subtle niuu-text-text-faint'
            }`}
            data-testid={`step-${step}`}
          >
            {i < idx ? '\u2713' : i + 1}
          </div>
          <span className={`niuu-text-xs ${i === idx ? 'niuu-text-text-primary' : 'niuu-text-text-faint'}`}>
            {STEP_LABELS[step]}
          </span>
          {i < steps.length - 1 && (
            <div className={`niuu-h-px niuu-w-8 ${i < idx ? 'niuu-bg-brand' : 'niuu-bg-border-subtle'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step: Template
// ---------------------------------------------------------------------------

function TemplateStep({
  templates,
  selectedId,
  onSelect,
}: {
  templates: Template[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="niuu-flex niuu-flex-col niuu-gap-3" data-testid="step-template-content">
      <h3 className="niuu-text-sm niuu-font-medium niuu-text-text-secondary">Choose a template</h3>
      <div className="niuu-grid niuu-grid-cols-2 niuu-gap-3">
        {templates.map((t) => (
          <button
            key={t.id}
            className={`niuu-flex niuu-flex-col niuu-gap-1 niuu-rounded-lg niuu-border niuu-p-3 niuu-text-left ${
              selectedId === t.id
                ? 'niuu-border-brand niuu-bg-bg-tertiary'
                : 'niuu-border-border-subtle niuu-bg-bg-secondary hover:niuu-border-brand'
            }`}
            onClick={() => onSelect(t.id)}
            data-testid="wizard-template-card"
          >
            <span className="niuu-font-mono niuu-text-sm niuu-text-text-primary">{t.name}</span>
            <span className="niuu-text-xs niuu-text-text-muted">{t.spec.image}:{t.spec.tag}</span>
            <span className="niuu-font-mono niuu-text-xs niuu-text-text-faint">
              {t.spec.resources.cpuRequest}c · {t.spec.resources.memRequestMi}Mi
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step: Source
// ---------------------------------------------------------------------------

function SourceStep({
  form,
  update,
}: {
  form: WizardForm;
  update: (patch: Partial<WizardForm>) => void;
}) {
  return (
    <div className="niuu-flex niuu-flex-col niuu-gap-4" data-testid="step-source-content">
      <h3 className="niuu-text-sm niuu-font-medium niuu-text-text-secondary">Workspace source</h3>
      <div className="niuu-flex niuu-gap-2">
        {(['git', 'local_mount', 'blank'] as const).map((t) => (
          <button
            key={t}
            className={`niuu-rounded niuu-px-3 niuu-py-1.5 niuu-text-xs ${
              form.sourcetype === t
                ? 'niuu-bg-brand niuu-text-bg-primary'
                : 'niuu-bg-bg-tertiary niuu-text-text-secondary hover:niuu-bg-bg-elevated'
            }`}
            onClick={() => update({ sourcetype: t })}
            data-testid={`source-tab-${t}`}
          >
            {t === 'local_mount' ? 'local mount' : t}
          </button>
        ))}
      </div>
      {form.sourcetype === 'git' && (
        <div className="niuu-flex niuu-flex-col niuu-gap-3">
          <Field label="Repository">
            <Input
              value={form.repo}
              onChange={(e) => update({ repo: e.target.value })}
              placeholder="niuu/volundr"
            />
          </Field>
          <Field label="Branch">
            <Input
              value={form.branch}
              onChange={(e) => update({ branch: e.target.value })}
              placeholder="main"
            />
          </Field>
        </div>
      )}
      {form.sourcetype === 'local_mount' && (
        <Field label="Path">
          <Input
            value={form.mountPath}
            onChange={(e) => update({ mountPath: e.target.value })}
            placeholder="~/code/niuu"
          />
        </Field>
      )}
      {form.sourcetype === 'blank' && (
        <p className="niuu-font-mono niuu-text-xs niuu-text-text-faint">
          Pod will boot with empty /workspace
        </p>
      )}
      <Field label="Session name (optional)">
        <Input
          value={form.sessionName}
          onChange={(e) => update({ sessionName: e.target.value })}
          placeholder="auto-generated from branch if blank"
        />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step: Runtime
// ---------------------------------------------------------------------------

function RuntimeStep({
  form,
  update,
}: {
  form: WizardForm;
  update: (patch: Partial<WizardForm>) => void;
}) {
  return (
    <div className="niuu-flex niuu-flex-col niuu-gap-4" data-testid="step-runtime-content">
      <div className="niuu-grid niuu-grid-cols-2 niuu-gap-6">
        <div className="niuu-flex niuu-flex-col niuu-gap-4">
          <h3 className="niuu-text-sm niuu-font-medium niuu-text-text-secondary">CLI & model</h3>
          <div className="niuu-flex niuu-flex-wrap niuu-gap-2">
            {CLI_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                className={`niuu-flex niuu-items-center niuu-gap-1.5 niuu-rounded niuu-border niuu-px-3 niuu-py-2 niuu-text-xs ${
                  form.cli === opt.id
                    ? 'niuu-border-brand niuu-bg-bg-tertiary'
                    : 'niuu-border-border-subtle niuu-bg-bg-secondary hover:niuu-border-brand'
                }`}
                onClick={() => update({ cli: opt.id })}
                data-testid={`cli-option-${opt.id}`}
              >
                <span className="niuu-font-mono niuu-text-base">{opt.rune}</span>
                <span className="niuu-font-mono">{opt.label}</span>
              </button>
            ))}
          </div>
          <Field label="Model">
            <Input
              value={form.model}
              onChange={(e) => update({ model: e.target.value })}
              placeholder="sonnet-primary"
            />
          </Field>
          <Field label="Permission">
            <select
              className="niuu-w-full niuu-rounded niuu-border niuu-border-border-subtle niuu-bg-bg-tertiary niuu-px-3 niuu-py-2 niuu-font-mono niuu-text-sm niuu-text-text-primary"
              value={form.permission}
              onChange={(e) => update({ permission: e.target.value })}
              data-testid="permission-select"
            >
              <option value="restricted">restricted</option>
              <option value="normal">normal</option>
              <option value="yolo">yolo</option>
            </select>
          </Field>
        </div>
        <div className="niuu-flex niuu-flex-col niuu-gap-4">
          <h3 className="niuu-text-sm niuu-font-medium niuu-text-text-secondary">Resources</h3>
          <Field label="CPU (cores)">
            <Input value={form.cpu} onChange={(e) => update({ cpu: e.target.value })} placeholder="2" />
          </Field>
          <Field label="Memory">
            <Input value={form.mem} onChange={(e) => update({ mem: e.target.value })} placeholder="8Gi" />
          </Field>
          <Field label="GPU">
            <Input value={form.gpu} onChange={(e) => update({ gpu: e.target.value })} placeholder="0" />
          </Field>
          <Field label="Forge (cluster)">
            <Input
              value={form.cluster}
              onChange={(e) => update({ cluster: e.target.value })}
              placeholder="valaskjalf"
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step: Confirm
// ---------------------------------------------------------------------------

function ConfirmStep({ form, templates }: { form: WizardForm; templates: Template[] }) {
  const tpl = templates.find((t) => t.id === form.templateId);
  return (
    <div className="niuu-flex niuu-flex-col niuu-gap-3" data-testid="step-confirm-content">
      <h3 className="niuu-text-sm niuu-font-medium niuu-text-text-secondary">Review</h3>
      <div className="niuu-flex niuu-flex-col niuu-divide-y niuu-divide-border-subtle">
        <ConfirmRow label="template" value={tpl?.name ?? form.templateId} />
        <ConfirmRow label="cli" value={form.cli} />
        <ConfirmRow label="model" value={form.model} />
        <ConfirmRow label="source" value={form.sourcetype === 'git' ? `${form.repo}@${form.branch}` : form.sourcetype === 'local_mount' ? form.mountPath : 'blank'} />
        <ConfirmRow label="resources" value={`${form.cpu}c \u00B7 ${form.mem}${form.gpu !== '0' ? ` \u00B7 gpu ${form.gpu}` : ''}`} />
        <ConfirmRow label="permission" value={form.permission} />
        <ConfirmRow label="forge" value={form.cluster || 'auto'} />
      </div>
    </div>
  );
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="niuu-flex niuu-items-center niuu-gap-4 niuu-py-2" data-testid="confirm-row">
      <span className="niuu-w-24 niuu-font-mono niuu-text-xs niuu-text-text-faint">{label}</span>
      <span className="niuu-font-mono niuu-text-sm niuu-text-text-primary">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step: Booting
// ---------------------------------------------------------------------------

function BootingStep({ bootStep, progress }: { bootStep: number; progress: number }) {
  return (
    <div className="niuu-flex niuu-flex-col niuu-items-center niuu-gap-6 niuu-py-4" data-testid="step-booting-content">
      {/* Anvil SVG */}
      <svg viewBox="0 0 200 80" className="niuu-h-20 niuu-w-48" aria-hidden>
        <rect x="70" y="48" width="60" height="10" rx="1" fill="var(--brand-500)" />
        <rect x="80" y="58" width="40" height="8" rx="1" fill="var(--brand-600, var(--brand-500))" />
        <rect x="90" y="66" width="20" height="10" rx="1" fill="var(--brand-700, var(--brand-500))" />
        <rect x="92" y="30" width="16" height="18" rx="2" fill="var(--brand-400)" opacity="0.7">
          <animate attributeName="opacity" values="0.6;1;0.7" dur="1.6s" repeatCount="indefinite" />
        </rect>
        <circle cx="70" cy="20" r="1.2" fill="var(--brand-300, var(--brand-500))">
          <animate attributeName="cy" values="20;4;20" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="1;0;0" dur="2s" repeatCount="indefinite" />
        </circle>
        <circle cx="100" cy="20" r="1.5" fill="var(--brand-400)">
          <animate attributeName="cy" values="20;0;20" dur="1.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="1;0;0" dur="1.6s" repeatCount="indefinite" />
        </circle>
        <circle cx="130" cy="20" r="1.2" fill="var(--brand-300, var(--brand-500))">
          <animate attributeName="cy" values="20;6;20" dur="2.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="1;0;0" dur="2.4s" repeatCount="indefinite" />
        </circle>
      </svg>
      {/* Progress bar */}
      <div className="niuu-w-full niuu-h-1.5 niuu-rounded-full niuu-bg-bg-elevated" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemax={100}>
        <div className="niuu-h-full niuu-rounded-full niuu-bg-brand niuu-transition-all" style={{ width: `${(progress * 100).toFixed(0)}%` }} />
      </div>
      {/* Step list */}
      <div className="niuu-flex niuu-flex-col niuu-gap-2 niuu-w-full">
        {BOOT_STEPS.map((step, i) => (
          <div
            key={step.id}
            className={`niuu-flex niuu-items-center niuu-gap-2 niuu-text-xs ${
              i < bootStep ? 'niuu-text-text-muted' : i === bootStep ? 'niuu-text-brand' : 'niuu-text-text-faint'
            }`}
            data-testid="boot-step"
          >
            <span className="niuu-w-4 niuu-text-center niuu-font-mono">
              {i < bootStep ? '\u2713' : i === bootStep ? '\u2026' : '\u25CB'}
            </span>
            <span className="niuu-font-mono">{step.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LaunchWizard
// ---------------------------------------------------------------------------

/** 4-step modal wizard for launching new Volundr sessions. */
export function LaunchWizard({ open, onOpenChange, initialTemplateId }: LaunchWizardProps) {
  const templates = useTemplates();
  const allTemplates = templates.data ?? [];

  const [step, setStep] = useState<WizardStep>('template');
  const [form, setForm] = useState<WizardForm>(() => ({
    templateId: initialTemplateId ?? allTemplates[0]?.id ?? '',
    sourcetype: 'git',
    repo: 'niuu/volundr',
    branch: 'main',
    mountPath: '~/code/niuu',
    sessionName: '',
    cli: 'claude',
    model: 'sonnet-primary',
    permission: 'restricted',
    cpu: '2',
    mem: '8Gi',
    gpu: '0',
    cluster: '',
  }));
  const [bootStep, setBootStep] = useState(0);
  const [bootProgress, setBootProgress] = useState(0);

  // Update template ID when templates load
  useEffect(() => {
    if (allTemplates.length > 0 && !form.templateId) {
      setForm((f) => ({ ...f, templateId: allTemplates[0]!.id }));
    }
  }, [allTemplates, form.templateId]);

  // Boot animation
  useEffect(() => {
    if (step !== 'booting') return;
    let i = 0;
    const total = BOOT_STEPS.length;
    const tick = () => {
      i++;
      setBootStep((s) => Math.min(s + 1, total - 1));
      setBootProgress((p) => Math.min(1, p + 1 / total));
      if (i < total - 1) {
        setTimeout(tick, 900);
      }
    };
    const timer = setTimeout(tick, 600);
    return () => clearTimeout(timer);
  }, [step]);

  const update = (patch: Partial<WizardForm>) => setForm((f) => ({ ...f, ...patch }));

  const stepIdx = STEPS.indexOf(step as (typeof STEPS)[number]);
  const canGoBack = stepIdx > 0 && step !== 'booting';
  const isLastStep = step === 'confirm';

  function handleNext() {
    if (isLastStep) {
      setStep('booting');
      setBootStep(0);
      setBootProgress(0);
      return;
    }
    if (stepIdx < STEPS.length - 1) {
      setStep(STEPS[stepIdx + 1]!);
    }
  }

  function handleBack() {
    if (stepIdx > 0) {
      setStep(STEPS[stepIdx - 1]!);
    }
  }

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep('template');
      setBootStep(0);
      setBootProgress(0);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={step === 'booting' ? 'Forging\u2026' : 'Launch pod'} data-testid="launch-wizard">
        <div className="niuu-flex niuu-flex-col niuu-gap-4 niuu-min-w-[600px]">
          {/* Step indicator */}
          {step !== 'booting' && <StepIndicator current={step} steps={STEPS} />}

          {/* Step content */}
          {step === 'template' && (
            <TemplateStep
              templates={allTemplates}
              selectedId={form.templateId}
              onSelect={(id) => update({ templateId: id })}
            />
          )}
          {step === 'source' && <SourceStep form={form} update={update} />}
          {step === 'runtime' && <RuntimeStep form={form} update={update} />}
          {step === 'confirm' && <ConfirmStep form={form} templates={allTemplates} />}
          {step === 'booting' && <BootingStep bootStep={bootStep} progress={bootProgress} />}

          {/* Footer */}
          <div className="niuu-flex niuu-items-center niuu-justify-between niuu-pt-4 niuu-border-t niuu-border-border-subtle">
            {canGoBack ? (
              <button
                className="niuu-rounded niuu-px-4 niuu-py-2 niuu-text-sm niuu-text-text-secondary hover:niuu-text-text-primary"
                onClick={handleBack}
                data-testid="wizard-back"
              >
                back
              </button>
            ) : (
              <div />
            )}
            {step === 'booting' ? (
              <button
                className="niuu-rounded niuu-bg-brand niuu-px-4 niuu-py-2 niuu-text-sm niuu-font-medium niuu-text-bg-primary disabled:niuu-opacity-50"
                disabled={bootProgress < 1}
                onClick={() => onOpenChange(false)}
                data-testid="wizard-open-pod"
              >
                {bootProgress < 1 ? 'booting\u2026' : 'open pod \u2192'}
              </button>
            ) : (
              <button
                className="niuu-rounded niuu-bg-brand niuu-px-4 niuu-py-2 niuu-text-sm niuu-font-medium niuu-text-bg-primary"
                onClick={handleNext}
                data-testid="wizard-next"
              >
                {isLastStep ? 'forge session' : 'continue \u2192'}
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

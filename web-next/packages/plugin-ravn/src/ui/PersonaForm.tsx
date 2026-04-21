import { useState, useCallback, useEffect, useMemo } from 'react';
import { EventPicker, SchemaEditor, ToolPicker, ValidationSummary, MountChip } from '@niuulabs/ui';
import type { FieldType, PersonaRole } from '@niuulabs/domain';
import type { PersonaDetail, PersonaCreateRequest, PersonaConsumesEvent } from '../ports';
import { validatePersona } from './validatePersona';
import { SEED_EVENT_CATALOG, SEED_TOOL_REGISTRY, PERSONA_ROLE_ORDER } from '../catalog';
import './PersonaForm.css';

const PERMISSION_MODES = ['default', 'safe', 'loose'] as const;
const MIMIR_ROUTINGS = ['local', 'shared', 'domain'] as const;

// ── Fan-in strategy definitions ────────────────────────────────────────────

const FAN_IN_STRATEGIES = [
  'all_must_pass',
  'any_passes',
  'quorum',
  'merge',
  'first_wins',
  'weighted_score',
] as const;

type FanInStrategy = (typeof FAN_IN_STRATEGIES)[number];

const FAN_IN_DESCRIPTIONS: Record<FanInStrategy, string> = {
  all_must_pass: 'All upstream events must arrive before processing',
  any_passes: 'First arriving event triggers processing',
  quorum: 'N of M events must arrive',
  merge: 'All events merged into a single context',
  first_wins: 'First event wins, others discarded',
  weighted_score: 'Events scored and ranked by weight',
};

// ── Fan-in SVG diagrams ─────────────────────────────────────────────────────

function AllMustPassDiagram() {
  return (
    <svg width={32} height={20} viewBox="0 0 32 20" fill="none" aria-hidden="true">
      <line x1="2" y1="5" x2="14" y2="10" stroke="currentColor" strokeWidth={1.5} />
      <line x1="2" y1="10" x2="14" y2="10" stroke="currentColor" strokeWidth={1.5} />
      <line x1="2" y1="15" x2="14" y2="10" stroke="currentColor" strokeWidth={1.5} />
      <circle cx="17" cy="10" r="3" fill="currentColor" />
      <line x1="20" y1="10" x2="30" y2="10" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

function AnyPassesDiagram() {
  return (
    <svg width={32} height={20} viewBox="0 0 32 20" fill="none" aria-hidden="true">
      <line x1="2" y1="5" x2="14" y2="10" stroke="currentColor" strokeWidth={1.5} />
      <line x1="2" y1="10" x2="14" y2="10" stroke="currentColor" strokeWidth={0.8} opacity={0.4} />
      <line x1="2" y1="15" x2="14" y2="10" stroke="currentColor" strokeWidth={0.8} opacity={0.4} />
      <polygon points="14,7 20,10 14,13" fill="currentColor" />
      <line x1="20" y1="10" x2="30" y2="10" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

function QuorumDiagram() {
  return (
    <svg width={32} height={20} viewBox="0 0 32 20" fill="none" aria-hidden="true">
      <line x1="2" y1="5" x2="12" y2="10" stroke="currentColor" strokeWidth={1.5} />
      <line x1="2" y1="10" x2="12" y2="10" stroke="currentColor" strokeWidth={1.5} />
      <line x1="2" y1="15" x2="12" y2="10" stroke="currentColor" strokeWidth={0.8} opacity={0.4} />
      <rect x="12" y="7" width="8" height="6" rx="1" fill="currentColor" opacity={0.6} />
      <line x1="20" y1="10" x2="30" y2="10" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

function MergeDiagram() {
  return (
    <svg width={32} height={20} viewBox="0 0 32 20" fill="none" aria-hidden="true">
      <line x1="2" y1="4" x2="14" y2="10" stroke="currentColor" strokeWidth={1.5} />
      <line x1="2" y1="10" x2="14" y2="10" stroke="currentColor" strokeWidth={1.5} />
      <line x1="2" y1="16" x2="14" y2="10" stroke="currentColor" strokeWidth={1.5} />
      <line x1="14" y1="10" x2="30" y2="10" stroke="currentColor" strokeWidth={3} />
    </svg>
  );
}

function FirstWinsDiagram() {
  return (
    <svg width={32} height={20} viewBox="0 0 32 20" fill="none" aria-hidden="true">
      <line x1="2" y1="5" x2="30" y2="5" stroke="currentColor" strokeWidth={1.5} />
      <line x1="2" y1="10" x2="18" y2="10" stroke="currentColor" strokeWidth={0.8} opacity={0.3} />
      <line x1="16" y1="8" x2="20" y2="12" stroke="currentColor" strokeWidth={1} opacity={0.3} />
      <line x1="16" y1="12" x2="20" y2="8" stroke="currentColor" strokeWidth={1} opacity={0.3} />
      <line x1="2" y1="15" x2="18" y2="15" stroke="currentColor" strokeWidth={0.8} opacity={0.3} />
      <line x1="16" y1="13" x2="20" y2="17" stroke="currentColor" strokeWidth={1} opacity={0.3} />
      <line x1="16" y1="17" x2="20" y2="13" stroke="currentColor" strokeWidth={1} opacity={0.3} />
    </svg>
  );
}

function WeightedScoreDiagram() {
  return (
    <svg width={32} height={20} viewBox="0 0 32 20" fill="none" aria-hidden="true">
      <rect x="2" y="12" width="6" height="6" fill="currentColor" opacity={0.5} />
      <rect x="11" y="6" width="6" height="12" fill="currentColor" opacity={0.8} />
      <rect x="20" y="9" width="6" height="9" fill="currentColor" opacity={0.65} />
      <line x1="1" y1="19" x2="31" y2="19" stroke="currentColor" strokeWidth={0.8} />
    </svg>
  );
}

const FAN_IN_DIAGRAMS: Record<FanInStrategy, React.ReactElement> = {
  all_must_pass: <AllMustPassDiagram />,
  any_passes: <AnyPassesDiagram />,
  quorum: <QuorumDiagram />,
  merge: <MergeDiagram />,
  first_wins: <FirstWinsDiagram />,
  weighted_score: <WeightedScoreDiagram />,
};

// ── System prompt preview ──────────────────────────────────────────────────

function renderPromptPreview(template: string): React.ReactNode[] {
  const parts = template.split(/({{[^}]+}})/g);
  return parts.map((part, i) => {
    if (/^{{[^}]+}}$/.test(part)) {
      return <mark key={i}>{part}</mark>;
    }
    return part;
  });
}

// ── Form state ─────────────────────────────────────────────────────────────

function detailToRequest(d: PersonaDetail): PersonaCreateRequest {
  return {
    name: d.name,
    role: d.role,
    letter: d.letter,
    color: d.color,
    summary: d.summary,
    description: d.description,
    systemPromptTemplate: d.systemPromptTemplate,
    allowedTools: d.allowedTools,
    forbiddenTools: d.forbiddenTools,
    permissionMode: d.permissionMode,
    iterationBudget: d.iterationBudget,
    llmPrimaryAlias: d.llm.primaryAlias,
    llmThinkingEnabled: d.llm.thinkingEnabled,
    llmMaxTokens: d.llm.maxTokens,
    llmTemperature: d.llm.temperature,
    producesEventType: d.produces.eventType,
    producesSchema: d.produces.schemaDef,
    consumesEvents: d.consumes.events,
    fanInStrategy: d.fanIn?.strategy,
    fanInParams: d.fanIn?.params,
    mimirWriteRouting: d.mimirWriteRouting,
  };
}

// ── Section components ─────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <section className="niuu-border niuu-border-border-subtle niuu-rounded-lg niuu-overflow-hidden">
      <div className="niuu-px-4 niuu-py-2 niuu-bg-bg-secondary niuu-border-b niuu-border-border-subtle">
        <h3 className="niuu-m-0 niuu-text-xs niuu-font-mono niuu-font-medium niuu-text-text-muted niuu-uppercase niuu-tracking-widest">
          {title}
        </h3>
      </div>
      <div className="niuu-p-4 niuu-flex niuu-flex-col niuu-gap-3 niuu-bg-bg-primary">
        {children}
      </div>
    </section>
  );
}

interface FieldRowProps {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}

function FieldRow({ label, htmlFor, children }: FieldRowProps) {
  return (
    <div className="niuu-grid niuu-grid-cols-[140px_1fr] niuu-gap-3 niuu-items-start">
      <label
        htmlFor={htmlFor}
        className="niuu-pt-2 niuu-text-sm niuu-text-text-muted niuu-font-sans"
      >
        {label}
      </label>
      <div>{children}</div>
    </div>
  );
}

// ── Main form ──────────────────────────────────────────────────────────────

export interface PersonaFormProps {
  persona: PersonaDetail;
  onSave: (req: PersonaCreateRequest) => Promise<void>;
  isSaving?: boolean;
}

export function PersonaForm({ persona, onSave, isSaving = false }: PersonaFormProps) {
  const [form, setForm] = useState<PersonaCreateRequest>(() => detailToRequest(persona));
  const [dirty, setDirty] = useState(false);
  const [showAllowPicker, setShowAllowPicker] = useState(false);
  const [showDenyPicker, setShowDenyPicker] = useState(false);
  const [showPromptPreview, setShowPromptPreview] = useState(false);

  // Sync form when persona prop changes (navigating to another persona).
  // Intentionally depend only on persona.name — not the full persona object —
  // so saving (which triggers a re-fetch) doesn't reset the form mid-edit.
  useEffect(() => {
    setForm(detailToRequest(persona));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona.name]);

  const validationErrors = validatePersona(form, SEED_EVENT_CATALOG);

  const update = useCallback(
    <K extends keyof PersonaCreateRequest>(key: K, value: PersonaCreateRequest[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setDirty(true);
    },
    [],
  );

  const handleReset = useCallback(() => {
    setForm(detailToRequest(persona));
    setDirty(false);
  }, [persona]);

  const handleSave = useCallback(async () => {
    if (validationErrors.length > 0) return;
    await onSave(form);
    setDirty(false);
  }, [form, onSave, validationErrors]);

  // Consumes events helpers
  const addConsumedEvent = useCallback(() => {
    update('consumesEvents', [...form.consumesEvents, { name: '' }]);
  }, [form.consumesEvents, update]);

  const updateConsumedEvent = useCallback(
    (i: number, patch: Partial<PersonaConsumesEvent>) => {
      const next = form.consumesEvents.map((e, idx) => (idx === i ? { ...e, ...patch } : e));
      update('consumesEvents', next);
    },
    [form.consumesEvents, update],
  );

  const removeConsumedEvent = useCallback(
    (i: number) => {
      update(
        'consumesEvents',
        form.consumesEvents.filter((_, idx) => idx !== i),
      );
    },
    [form.consumesEvents, update],
  );

  const promptCharCount = useMemo(
    () => (form.systemPromptTemplate ?? '').length,
    [form.systemPromptTemplate],
  );
  const promptTokenEstimate = useMemo(
    () => Math.ceil(promptCharCount / 4),
    [promptCharCount],
  );

  return (
    <div className="niuu-flex niuu-flex-col niuu-h-full" data-testid="persona-form">
      {/* Save bar */}
      {dirty && (
        <div className="niuu-flex niuu-items-center niuu-justify-between niuu-px-4 niuu-py-2 niuu-bg-bg-secondary niuu-border-b niuu-border-border">
          <span className="niuu-text-sm niuu-text-text-muted">Unsaved changes</span>
          <div className="niuu-flex niuu-gap-2">
            <button
              type="button"
              onClick={handleReset}
              className="niuu-px-3 niuu-py-1 niuu-text-sm niuu-text-text-secondary niuu-bg-transparent niuu-border niuu-border-border niuu-rounded-md niuu-cursor-pointer hover:niuu-bg-bg-tertiary"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving || validationErrors.length > 0}
              aria-label="Save persona"
              className="niuu-px-3 niuu-py-1 niuu-text-sm niuu-text-text-primary niuu-bg-brand niuu-border niuu-border-transparent niuu-rounded-md niuu-cursor-pointer disabled:niuu-opacity-50"
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div className="niuu-flex-1 niuu-overflow-y-auto niuu-p-4 niuu-flex niuu-flex-col niuu-gap-4">
        {validationErrors.length > 0 && (
          <ValidationSummary
            errors={validationErrors.map((e) => ({
              id: e.field,
              label: e.field,
              message: e.message,
            }))}
          />
        )}

        {/* Identity */}
        <Section title="Identity">
          <FieldRow label="Name" htmlFor="pf-name">
            <input
              id="pf-name"
              className="niuu-form-control"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
            />
          </FieldRow>
          <FieldRow label="Role" htmlFor="pf-role">
            <select
              id="pf-role"
              className="niuu-form-control"
              value={form.role}
              onChange={(e) => update('role', e.target.value as PersonaRole)}
            >
              {PERSONA_ROLE_ORDER.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow label="Letter" htmlFor="pf-letter">
            <input
              id="pf-letter"
              className="niuu-form-control niuu-w-16"
              value={form.letter}
              maxLength={1}
              onChange={(e) => update('letter', e.target.value.slice(0, 1).toUpperCase())}
            />
          </FieldRow>
          <FieldRow label="Summary" htmlFor="pf-summary">
            <input
              id="pf-summary"
              className="niuu-form-control"
              value={form.summary}
              onChange={(e) => update('summary', e.target.value)}
            />
          </FieldRow>
          <FieldRow label="Description" htmlFor="pf-desc">
            <textarea
              id="pf-desc"
              className="niuu-form-control"
              rows={3}
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
            />
          </FieldRow>
        </Section>

        {/* System prompt */}
        <Section title="System prompt">
          <FieldRow label="Template" htmlFor="pf-system-prompt">
            <textarea
              id="pf-system-prompt"
              data-testid="pf-system-prompt"
              className="niuu-form-control niuu-font-mono niuu-text-xs"
              rows={8}
              value={form.systemPromptTemplate ?? ''}
              placeholder="Enter Jinja2 template… Use {{variable}} for dynamic values."
              onChange={(e) => update('systemPromptTemplate', e.target.value)}
            />
            <div className="niuu-flex niuu-items-center niuu-justify-between niuu-mt-1">
              <button
                type="button"
                onClick={() => setShowPromptPreview((v) => !v)}
                className="niuu-text-xs niuu-text-text-muted niuu-bg-transparent niuu-border-0 niuu-cursor-pointer hover:niuu-text-text-secondary niuu-p-0"
              >
                {showPromptPreview ? 'Hide preview' : 'Show preview'}
              </button>
              <span
                className="niuu-text-xs niuu-text-text-muted niuu-font-mono"
                data-testid="pf-prompt-char-count"
              >
                {promptCharCount} chars · ~{promptTokenEstimate} tokens
              </span>
            </div>
          </FieldRow>
          {showPromptPreview && form.systemPromptTemplate && (
            <div
              data-testid="pf-prompt-preview"
              className="rv-prompt-preview niuu-p-3 niuu-bg-bg-secondary niuu-rounded-md niuu-border niuu-border-border-subtle"
            >
              {renderPromptPreview(form.systemPromptTemplate)}
            </div>
          )}
        </Section>

        {/* LLM */}
        <Section title="LLM">
          <FieldRow label="Model alias" htmlFor="pf-llm-alias">
            <input
              id="pf-llm-alias"
              className="niuu-form-control niuu-font-mono"
              value={form.llmPrimaryAlias}
              onChange={(e) => update('llmPrimaryAlias', e.target.value)}
              placeholder="claude-sonnet-4-6"
            />
          </FieldRow>
          <FieldRow label="Thinking" htmlFor="pf-llm-thinking">
            <label className="niuu-flex niuu-items-center niuu-gap-2 niuu-cursor-pointer niuu-select-none">
              <input
                id="pf-llm-thinking"
                type="checkbox"
                checked={form.llmThinkingEnabled}
                onChange={(e) => update('llmThinkingEnabled', e.target.checked)}
                className="niuu-w-4 niuu-h-4"
              />
              <span className="niuu-text-sm niuu-text-text-secondary">
                Enable extended thinking
              </span>
            </label>
          </FieldRow>
          <FieldRow label="Max tokens" htmlFor="pf-llm-max-tokens">
            <input
              id="pf-llm-max-tokens"
              type="number"
              className="niuu-form-control niuu-w-36"
              value={form.llmMaxTokens}
              min={1}
              step={1024}
              onChange={(e) => update('llmMaxTokens', parseInt(e.target.value, 10) || 8192)}
            />
          </FieldRow>
          <FieldRow label="Temperature" htmlFor="pf-llm-temp">
            <input
              id="pf-llm-temp"
              type="number"
              className="niuu-form-control niuu-w-24"
              value={form.llmTemperature ?? ''}
              min={0}
              max={2}
              step={0.1}
              placeholder="model default"
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                update('llmTemperature', isNaN(v) ? undefined : v);
              }}
            />
          </FieldRow>
        </Section>

        {/* Tool access */}
        <Section title="Tool access">
          <FieldRow label="Permission mode" htmlFor="pf-perm">
            <select
              id="pf-perm"
              className="niuu-form-control niuu-w-40"
              value={form.permissionMode}
              onChange={(e) => update('permissionMode', e.target.value)}
            >
              {PERMISSION_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow label="Allow list">
            <div className="niuu-flex niuu-flex-wrap niuu-gap-1 niuu-mb-2">
              {form.allowedTools.map((toolId) => {
                const tool = SEED_TOOL_REGISTRY.find((t) => t.id === toolId);
                return (
                  <span
                    key={toolId}
                    className={[
                      'niuu-inline-flex niuu-items-center niuu-gap-1 niuu-px-2 niuu-py-0 niuu-rounded niuu-text-xs niuu-font-mono',
                      tool?.destructive
                        ? 'niuu-bg-critical/10 niuu-text-critical niuu-border niuu-border-critical/30'
                        : 'niuu-bg-bg-tertiary niuu-text-text-secondary niuu-border niuu-border-border',
                    ].join(' ')}
                  >
                    {tool?.destructive && (
                      <span className="niuu-inline-block niuu-w-1.5 niuu-h-1.5 niuu-rounded-full niuu-bg-critical" />
                    )}
                    {toolId}
                    <button
                      type="button"
                      aria-label={`Remove ${toolId} from allow list`}
                      onClick={() =>
                        update(
                          'allowedTools',
                          form.allowedTools.filter((t) => t !== toolId),
                        )
                      }
                      className="niuu-ml-0.5 niuu-text-text-muted hover:niuu-text-text-primary niuu-border-0 niuu-bg-transparent niuu-cursor-pointer"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setShowAllowPicker(true)}
              className="niuu-text-sm niuu-text-text-secondary niuu-border niuu-border-dashed niuu-border-border niuu-px-2 niuu-py-0.5 niuu-rounded niuu-cursor-pointer hover:niuu-border-brand hover:niuu-text-text-primary niuu-bg-transparent"
            >
              + Add tool
            </button>
          </FieldRow>
          <FieldRow label="Deny list">
            <div className="niuu-flex niuu-flex-wrap niuu-gap-1 niuu-mb-2">
              {form.forbiddenTools.map((toolId) => (
                <span
                  key={toolId}
                  className="niuu-inline-flex niuu-items-center niuu-gap-1 niuu-px-2 niuu-py-0 niuu-rounded niuu-text-xs niuu-font-mono niuu-bg-bg-tertiary niuu-text-text-secondary niuu-border niuu-border-border"
                >
                  {toolId}
                  <button
                    type="button"
                    aria-label={`Remove ${toolId} from deny list`}
                    onClick={() =>
                      update(
                        'forbiddenTools',
                        form.forbiddenTools.filter((t) => t !== toolId),
                      )
                    }
                    className="niuu-ml-0.5 niuu-text-text-muted hover:niuu-text-text-primary niuu-border-0 niuu-bg-transparent niuu-cursor-pointer"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowDenyPicker(true)}
              className="niuu-text-sm niuu-text-text-secondary niuu-border niuu-border-dashed niuu-border-border niuu-px-2 niuu-py-0.5 niuu-rounded niuu-cursor-pointer hover:niuu-border-brand hover:niuu-text-text-primary niuu-bg-transparent"
            >
              + Add tool
            </button>
          </FieldRow>
        </Section>

        {/* Produces */}
        <Section title="Produces">
          <FieldRow label="Event">
            <EventPicker
              value={form.producesEventType}
              onChange={(v) => update('producesEventType', v)}
              catalog={SEED_EVENT_CATALOG}
              allowNew
              allowEmpty
            />
          </FieldRow>
          {form.producesEventType && (
            <FieldRow label="Schema">
              <SchemaEditor
                value={form.producesSchema}
                onChange={(v) => update('producesSchema', v as Record<string, FieldType>)}
              />
            </FieldRow>
          )}
        </Section>

        {/* Consumes */}
        <Section title="Consumes">
          <div className="niuu-flex niuu-flex-col niuu-gap-3">
            {form.consumesEvents.map((ev, i) => (
              <div
                key={i}
                className="niuu-flex niuu-items-start niuu-gap-2 niuu-p-3 niuu-bg-bg-secondary niuu-rounded-md niuu-border niuu-border-border-subtle"
              >
                <div className="niuu-flex-1 niuu-flex niuu-flex-col niuu-gap-2">
                  <EventPicker
                    value={ev.name}
                    onChange={(v) => updateConsumedEvent(i, { name: v })}
                    catalog={SEED_EVENT_CATALOG}
                  />
                  <input
                    className="niuu-form-control niuu-font-mono niuu-text-xs"
                    value={ev.injects?.join(', ') ?? ''}
                    onChange={(e) => {
                      const injects = e.target.value
                        ? e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean)
                        : [];
                      updateConsumedEvent(i, { injects });
                    }}
                    placeholder="inject keys (comma-separated)"
                    aria-label="Inject keys"
                  />
                  <input
                    type="number"
                    className="niuu-form-control niuu-w-28"
                    value={ev.trust ?? ''}
                    min={0}
                    max={1}
                    step={0.1}
                    onChange={(e) => {
                      const t = parseFloat(e.target.value);
                      updateConsumedEvent(i, { trust: isNaN(t) ? undefined : t });
                    }}
                    placeholder="trust (0–1)"
                    aria-label="Producer trust threshold"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeConsumedEvent(i)}
                  aria-label={`Remove consumed event ${ev.name}`}
                  className="niuu-border-0 niuu-bg-transparent niuu-cursor-pointer niuu-text-text-muted hover:niuu-text-critical niuu-mt-1 niuu-p-1"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addConsumedEvent}
              className="niuu-text-sm niuu-text-text-secondary niuu-border niuu-border-dashed niuu-border-border niuu-px-3 niuu-py-1.5 niuu-rounded niuu-cursor-pointer hover:niuu-border-brand hover:niuu-text-text-primary niuu-bg-transparent niuu-self-start"
            >
              + Add consumed event
            </button>
          </div>
        </Section>

        {/* Fan-in */}
        <Section title="Fan-in">
          <div className="rv-fanin-grid" data-testid="fanin-cards">
            {FAN_IN_STRATEGIES.map((s) => {
              const isActive = form.fanInStrategy === s;
              return (
                <button
                  key={s}
                  type="button"
                  data-testid={`fanin-card-${s}`}
                  aria-pressed={isActive}
                  onClick={() => update('fanInStrategy', s)}
                  className={`rv-fanin-card${isActive ? ' rv-fanin-card--active' : ''}`}
                >
                  <span className="rv-fanin-card__diagram">{FAN_IN_DIAGRAMS[s]}</span>
                  <span className="rv-fanin-card__name">{s}</span>
                  <span className="rv-fanin-card__desc">{FAN_IN_DESCRIPTIONS[s]}</span>
                </button>
              );
            })}
          </div>

          {/* "None" option */}
          <button
            type="button"
            onClick={() => update('fanInStrategy', undefined)}
            className={[
              'niuu-mt-2 niuu-text-xs niuu-text-text-muted niuu-bg-transparent niuu-border-0',
              'niuu-cursor-pointer niuu-px-0 hover:niuu-text-text-secondary niuu-self-start',
              !form.fanInStrategy ? 'niuu-underline' : '',
            ].join(' ')}
          >
            {form.fanInStrategy ? 'Clear strategy (none)' : '— no strategy selected —'}
          </button>

          {/* Quorum params */}
          {form.fanInStrategy === 'quorum' && (
            <div className="niuu-flex niuu-items-center niuu-gap-3 niuu-mt-2">
              <label
                htmlFor="pf-fanin-quorum"
                className="niuu-text-sm niuu-text-text-muted niuu-font-sans"
              >
                Quorum count
              </label>
              <input
                id="pf-fanin-quorum"
                type="number"
                className="niuu-form-control niuu-w-24"
                min={1}
                value={(form.fanInParams as Record<string, number> | undefined)?.quorum ?? 2}
                onChange={(e) =>
                  update('fanInParams', { ...form.fanInParams, quorum: parseInt(e.target.value, 10) || 2 })
                }
              />
            </div>
          )}

          {/* Weighted score params */}
          {form.fanInStrategy === 'weighted_score' && (
            <div className="niuu-flex niuu-items-center niuu-gap-3 niuu-mt-2">
              <label
                htmlFor="pf-fanin-threshold"
                className="niuu-text-sm niuu-text-text-muted niuu-font-sans"
              >
                Min score threshold
              </label>
              <input
                id="pf-fanin-threshold"
                type="number"
                className="niuu-form-control niuu-w-24"
                min={0}
                max={1}
                step={0.1}
                value={(form.fanInParams as Record<string, number> | undefined)?.threshold ?? 0.5}
                onChange={(e) =>
                  update('fanInParams', {
                    ...form.fanInParams,
                    threshold: parseFloat(e.target.value) || 0.5,
                  })
                }
              />
            </div>
          )}
        </Section>

        {/* Mímir write routing */}
        <Section title="Mímir write routing">
          <FieldRow label="Route writes to">
            <div className="niuu-flex niuu-items-center niuu-gap-2">
              {MIMIR_ROUTINGS.map((r) => (
                <label
                  key={r}
                  className="niuu-flex niuu-items-center niuu-gap-1.5 niuu-cursor-pointer niuu-select-none"
                >
                  <input
                    type="radio"
                    name="mimir-routing"
                    value={r}
                    checked={form.mimirWriteRouting === r}
                    onChange={() => update('mimirWriteRouting', r)}
                    className="niuu-w-3.5 niuu-h-3.5"
                  />
                  <MountChip name={r} role={r} />
                </label>
              ))}
              <label className="niuu-flex niuu-items-center niuu-gap-1.5 niuu-cursor-pointer niuu-select-none">
                <input
                  type="radio"
                  name="mimir-routing"
                  value=""
                  checked={form.mimirWriteRouting === undefined}
                  onChange={() => update('mimirWriteRouting', undefined)}
                  className="niuu-w-3.5 niuu-h-3.5"
                />
                <span className="niuu-text-sm niuu-text-text-muted">inherit global default</span>
              </label>
            </div>
          </FieldRow>
        </Section>

        {/* Iteration budget */}
        <Section title="Iteration budget">
          <FieldRow label="Max iterations" htmlFor="pf-budget">
            <input
              id="pf-budget"
              type="number"
              className="niuu-form-control niuu-w-24"
              value={form.iterationBudget}
              min={1}
              max={500}
              onChange={(e) => update('iterationBudget', parseInt(e.target.value, 10) || 25)}
            />
          </FieldRow>
        </Section>
      </div>

      {/* ToolPicker modals */}
      <ToolPicker
        open={showAllowPicker}
        onOpenChange={setShowAllowPicker}
        registry={SEED_TOOL_REGISTRY}
        selected={form.allowedTools}
        excluded={form.forbiddenTools}
        onToggle={(id) => {
          update(
            'allowedTools',
            form.allowedTools.includes(id)
              ? form.allowedTools.filter((t) => t !== id)
              : [...form.allowedTools, id],
          );
        }}
        label="Allow list — select tools"
      />
      <ToolPicker
        open={showDenyPicker}
        onOpenChange={setShowDenyPicker}
        registry={SEED_TOOL_REGISTRY}
        selected={form.forbiddenTools}
        excluded={form.allowedTools}
        onToggle={(id) => {
          update(
            'forbiddenTools',
            form.forbiddenTools.includes(id)
              ? form.forbiddenTools.filter((t) => t !== id)
              : [...form.forbiddenTools, id],
          );
        }}
        label="Deny list — select tools"
      />
    </div>
  );
}

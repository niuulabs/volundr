import { useState } from 'react';
import { cn } from '@niuulabs/ui';
import type { Workflow, WorkflowNode, WorkflowStageNode } from '../../domain/workflow';
import type { WorkflowIssue } from '../../domain/workflowValidation';
import type { WorkflowBuilderActions } from './useWorkflowBuilder';
import type { PersonaEntry } from './LibraryPanel';
import { normalizedStageMembers } from './graphUtils';

export interface WorkflowDetailPanelProps {
  workflow: Workflow;
  selectedNode: WorkflowNode | null;
  errorCount: number;
  warnCount: number;
  issues: WorkflowIssue[];
  personas: PersonaEntry[];
  onDeleteNode: WorkflowBuilderActions['deleteNode'];
  onUpdateNode: WorkflowBuilderActions['updateNode'];
  onUpdateLabel: WorkflowBuilderActions['updateNodeLabel'];
  onUpdateWorkflowMeta: WorkflowBuilderActions['updateWorkflowMeta'];
  onAddPersona: WorkflowBuilderActions['addPersonaToStage'];
  onReplacePersona: WorkflowBuilderActions['replacePersonaInStage'];
  onUpdatePersonaBudget: WorkflowBuilderActions['updatePersonaBudget'];
  onRemovePersona: WorkflowBuilderActions['removePersonaFromStage'];
}

const SECTION_LABEL =
  'niuu-text-[10px] niuu-font-semibold niuu-uppercase niuu-tracking-[0.24em] niuu-text-text-faint niuu-font-mono';
const INPUT =
  'niuu-w-full niuu-py-3 niuu-px-5 niuu-bg-bg-tertiary niuu-border niuu-border-border-subtle niuu-rounded-[14px] niuu-text-text-primary niuu-font-sans niuu-text-sm';
const CHIP_BTN =
  'niuu-rounded-md niuu-border niuu-px-2.5 niuu-py-1.5 niuu-text-xs niuu-font-mono niuu-transition-colors';
const TAG =
  'niuu-inline-flex niuu-items-center niuu-rounded-md niuu-border niuu-px-2.5 niuu-py-1 niuu-text-[11px] niuu-font-mono';
const TAB_BTN =
  'niuu-px-0 niuu-py-2.5 niuu-bg-transparent niuu-border-none niuu-border-b-2 niuu-text-xs niuu-font-mono niuu-uppercase niuu-tracking-[0.18em]';
const DELETE_BTN =
  'niuu-inline-flex niuu-items-center niuu-rounded-xl niuu-border niuu-border-critical/60 niuu-bg-critical-bg/25 niuu-px-3 niuu-py-2 niuu-text-sm niuu-font-semibold niuu-text-[#ffb0b0]';

function modeButton(active: boolean) {
  return active
    ? `${CHIP_BTN} niuu-bg-brand/15 niuu-border-brand/50 niuu-text-brand`
    : `${CHIP_BTN} niuu-bg-bg-elevated niuu-border-border niuu-text-text-secondary`;
}

function issueTone(severity: WorkflowIssue['severity']) {
  return severity === 'error'
    ? 'niuu-border-critical/40 niuu-bg-critical-bg/30 niuu-text-critical'
    : 'niuu-border-status-amber/40 niuu-bg-status-amber/10 niuu-text-status-amber';
}

function personaById(personas: PersonaEntry[], id: string) {
  return personas.find((persona) => persona.id === id);
}

function personaGlyph(role?: string) {
  switch (role) {
    case 'plan':
      return 'D';
    case 'build':
      return 'C';
    case 'verify':
      return 'V';
    case 'gate':
      return 'I';
    default:
      return '•';
  }
}

function memberIssuesForPersona(
  issues: WorkflowIssue[],
  persona: PersonaEntry | undefined,
) {
  if (!persona) return [];
  const keys = [persona.label, ...(persona.produces ?? []), ...(persona.consumes ?? [])].map((v) =>
    v.toLowerCase(),
  );
  return issues.filter((issue) => keys.some((key) => issue.message.toLowerCase().includes(key)));
}

function WorkflowSummary({
  workflow,
  errorCount,
  warnCount,
  onUpdateWorkflowMeta,
}: {
  workflow: Workflow;
  errorCount: number;
  warnCount: number;
  onUpdateWorkflowMeta: WorkflowBuilderActions['updateWorkflowMeta'];
}) {
  const stageCount = workflow.nodes.filter((n) => n.kind === 'stage').length;
  const triggerCount = workflow.nodes.filter((n) => n.kind === 'trigger').length;
  const gateCount = workflow.nodes.filter((n) => n.kind === 'gate').length;
  const condCount = workflow.nodes.filter((n) => n.kind === 'cond').length;
  const endCount = workflow.nodes.filter((n) => n.kind === 'end').length;

  return (
    <div className="niuu-px-4 niuu-py-3 niuu-flex niuu-flex-col niuu-gap-4">
      <div>
        <label className={SECTION_LABEL}>Name</label>
        <input
          className={INPUT}
          value={workflow.name}
          onChange={(e) => onUpdateWorkflowMeta({ name: e.target.value })}
        />
      </div>

      <div>
        <label className={SECTION_LABEL}>Description</label>
        <textarea
          className={cn(INPUT, 'niuu-min-h-[84px] niuu-leading-relaxed')}
          value={workflow.description ?? ''}
          onChange={(e) => onUpdateWorkflowMeta({ description: e.target.value })}
        />
      </div>

      <div className="niuu-grid niuu-grid-cols-2 niuu-gap-2">
        <div className="niuu-rounded-md niuu-border niuu-border-border-subtle niuu-bg-bg-elevated niuu-p-3">
          <div className={SECTION_LABEL}>Version</div>
          <input
            className={cn(INPUT, 'niuu-mt-1')}
            value={workflow.version ?? '0.1.0'}
            onChange={(e) => onUpdateWorkflowMeta({ version: e.target.value })}
          />
        </div>
        <div className="niuu-rounded-md niuu-border niuu-border-border-subtle niuu-bg-bg-elevated niuu-p-3">
          <div className={SECTION_LABEL}>Summary</div>
          <div className="niuu-mt-2 niuu-text-xs niuu-text-text-secondary niuu-leading-relaxed">
            {triggerCount} triggers · {stageCount} stages · {gateCount} gates · {condCount}{' '}
            conditions · {endCount} end nodes · {workflow.edges.length} edges
          </div>
        </div>
      </div>

      <div className="niuu-rounded-md niuu-border niuu-border-border-subtle niuu-bg-bg-elevated niuu-p-3 niuu-flex niuu-gap-2">
        <span className={cn(CHIP_BTN, errorCount ? 'niuu-border-critical niuu-text-critical' : 'niuu-border-border niuu-text-text-faint')}>
          ERR {errorCount}
        </span>
        <span className={cn(CHIP_BTN, warnCount ? 'niuu-border-status-amber niuu-text-status-amber' : 'niuu-border-border niuu-text-text-faint')}>
          WARN {warnCount}
        </span>
      </div>
    </div>
  );
}

function StageInspector({
  node,
  workflow,
  personas,
  issues,
  onUpdateNode,
  onUpdateLabel,
  onAddPersona,
  onReplacePersona,
  onUpdatePersonaBudget,
  onRemovePersona,
  onDeleteNode,
}: {
  node: WorkflowStageNode;
  workflow: Workflow;
  personas: PersonaEntry[];
  issues: WorkflowIssue[];
  onUpdateNode: WorkflowBuilderActions['updateNode'];
  onUpdateLabel: WorkflowBuilderActions['updateNodeLabel'];
  onAddPersona: WorkflowBuilderActions['addPersonaToStage'];
  onReplacePersona: WorkflowBuilderActions['replacePersonaInStage'];
  onUpdatePersonaBudget: WorkflowBuilderActions['updatePersonaBudget'];
  onRemovePersona: WorkflowBuilderActions['removePersonaFromStage'];
  onDeleteNode: WorkflowBuilderActions['deleteNode'];
}) {
  const [tab, setTab] = useState<'config' | 'flock' | 'validate'>('config');
  const inbound = workflow.edges.filter((edge) => edge.target === node.id);
  const outbound = workflow.edges.filter((edge) => edge.source === node.id);
  const nodeIssues = issues.filter((issue) => issue.nodeId === node.id);
  const stageMembers = normalizedStageMembers(node);
  const availablePersonas = personas.filter(
    (persona) => !stageMembers.some((member) => member.personaId === persona.id),
  );

  return (
    <div className="niuu-px-4 niuu-py-0 niuu-flex niuu-flex-col niuu-gap-4">
      <div className="niuu-flex niuu-items-center niuu-justify-between niuu-py-5 niuu-border-b niuu-border-border niuu-mx-[-16px] niuu-px-4">
        <div className="niuu-flex niuu-items-center niuu-gap-3">
          <span className="niuu-text-xl niuu-text-text-primary">◆</span>
          <span className="niuu-text-[20px] niuu-font-semibold niuu-text-text-primary">{node.kind === 'stage' ? 'Stage' : node.label}</span>
        </div>
        <span className="niuu-text-sm niuu-font-mono niuu-text-text-faint">{node.id}</span>
      </div>
      <div className="niuu-flex niuu-gap-6 niuu-pb-1 niuu-mb-2 niuu-border-b niuu-border-border niuu-mx-[-16px] niuu-px-4">
        {(['config', 'flock', 'validate'] as const).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            className={cn(
              TAB_BTN,
              tab === name
                ? 'niuu-border-text-primary niuu-text-text-primary'
                : 'niuu-border-transparent niuu-text-text-faint',
            )}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === 'config' && (
        <>
          <div>
            <label className={SECTION_LABEL}>Name</label>
            <input
              className={INPUT}
              value={node.label}
              onChange={(e) => onUpdateLabel(node.id, e.target.value)}
            />
          </div>

          <div>
            <label className={SECTION_LABEL}>Execution</label>
            <div className="niuu-flex niuu-gap-2 niuu-mt-1">
              {(['parallel', 'sequential'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={modeButton((node.executionMode ?? 'parallel') === mode)}
                  onClick={() => onUpdateNode(node.id, { executionMode: mode })}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <div className="niuu-grid niuu-grid-cols-2 niuu-gap-2">
            <div>
              <label className={SECTION_LABEL}>Max concurrent</label>
              <input
                type="number"
                className={INPUT}
                value={node.maxConcurrent ?? 3}
                min={1}
                onChange={(e) =>
                  onUpdateNode(node.id, { maxConcurrent: Math.max(1, Number(e.target.value) || 1) })
                }
              />
            </div>
            <div />
          </div>

          {(inbound.length > 0 || outbound.length > 0) && (
            <div className="niuu-rounded-md niuu-border niuu-border-border-subtle niuu-bg-bg-elevated niuu-p-3 niuu-flex niuu-flex-col niuu-gap-2">
              <div className={SECTION_LABEL}>Fan-in / fan-out</div>
              <div className="niuu-text-xs niuu-text-text-secondary">
                {inbound.length} incoming · {outbound.length} outgoing
              </div>
              <div className="niuu-flex niuu-gap-2 niuu-flex-wrap">
                {(['all', 'any', 'merge'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={modeButton((node.joinMode ?? 'all') === mode)}
                    onClick={() => onUpdateNode(node.id, { joinMode: mode })}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="niuu-border-t niuu-border-border niuu-pt-4">
            <button type="button" className={DELETE_BTN} onClick={() => onDeleteNode(node.id)}>
              Delete node
            </button>
          </div>
        </>
      )}

      {tab === 'flock' && (
        <>
          <div className={SECTION_LABEL}>Personas in this stage</div>
          <div className="niuu-flex niuu-flex-col niuu-gap-2">
            {stageMembers.length === 0 && (
              <div className="niuu-rounded-md niuu-border niuu-border-border-subtle niuu-bg-bg-elevated niuu-p-3 niuu-text-xs niuu-text-text-muted">
                No ravns assigned yet.
              </div>
            )}
            {stageMembers.map((member) => {
              const persona = personaById(personas, member.personaId);
              const memberIssues = memberIssuesForPersona(nodeIssues, persona);
              return (
                <div
                  key={member.personaId}
                  className="niuu-rounded-[18px] niuu-border niuu-border-border-subtle niuu-bg-bg-elevated niuu-p-5 niuu-flex niuu-flex-col niuu-gap-4"
                >
                  <div className="niuu-flex niuu-items-start niuu-gap-2">
                    <div className="niuu-flex niuu-h-10 niuu-w-10 niuu-items-center niuu-justify-center niuu-rounded-full niuu-border-2 niuu-border-[#aeddff] niuu-text-[#d6efff] niuu-font-mono niuu-text-xl">
                      {personaGlyph(persona?.role)}
                    </div>
                    <div className="niuu-flex-1 niuu-min-w-0">
                      <div className="niuu-text-[17px] niuu-font-semibold niuu-text-text-primary">
                        {persona?.label ?? member.personaId}
                      </div>
                      <div className="niuu-text-[11px] niuu-font-mono niuu-text-text-faint">
                        {persona?.role ?? 'unknown'}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="niuu-bg-transparent niuu-border-none niuu-text-text-faint niuu-text-2xl niuu-leading-none"
                      onClick={() => onRemovePersona(node.id, member.personaId)}
                    >
                      ×
                    </button>
                  </div>

                  <div className="niuu-flex niuu-items-center niuu-gap-3">
                    <span className="niuu-text-[13px] niuu-text-text-muted">budget</span>
                    <input
                      type="number"
                      className="niuu-w-20 niuu-bg-transparent niuu-border-none niuu-p-0 niuu-text-[18px] niuu-font-semibold niuu-text-text-primary"
                      value={member.budget}
                      min={0}
                      onChange={(e) =>
                        onUpdatePersonaBudget(
                          node.id,
                          member.personaId,
                          Math.max(0, Number(e.target.value) || 0),
                        )
                      }
                    />
                  </div>

                  <div className="niuu-grid niuu-grid-cols-1 niuu-gap-3">
                    <div>
                      <div className={SECTION_LABEL}>Consumes</div>
                      <div className="niuu-flex niuu-flex-wrap niuu-gap-1 niuu-mt-1">
                        {(persona?.consumes ?? []).map((event) => (
                          <span
                            key={event}
                            className={cn(
                              TAG,
                              'niuu-border-transparent niuu-bg-[#4f6474] niuu-text-[#d6efff]',
                            )}
                          >
                            {event}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className={SECTION_LABEL}>Produces</div>
                      <div className="niuu-flex niuu-flex-wrap niuu-gap-1 niuu-mt-1">
                        {(persona?.produces ?? []).map((event) => (
                          <span
                            key={event}
                            className={cn(
                              TAG,
                              memberIssues.length > 0
                                ? 'niuu-border-[#b75159] niuu-border-dashed niuu-bg-[#4b3136] niuu-text-[#ffb0b0]'
                                : 'niuu-border-transparent niuu-bg-bg-primary niuu-text-text-primary',
                            )}
                          >
                            {event}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {memberIssues.length > 0 && (
                    <div className="niuu-rounded-xl niuu-border niuu-border-[#b75159] niuu-bg-[#4b3136] niuu-p-4 niuu-text-[#ffb0b0]">
                      <div className="niuu-text-[15px] niuu-font-semibold niuu-leading-snug">
                        {memberIssues[0]?.message}
                      </div>
                    </div>
                  )}

                  <div>
                    <div className={SECTION_LABEL}>Ravn</div>
                    <select
                      className={cn(INPUT, 'niuu-mt-1')}
                      value={member.personaId}
                      onChange={(e) => onReplacePersona(node.id, member.personaId, e.target.value)}
                    >
                      {personas.map((personaOption) => (
                        <option key={personaOption.id} value={personaOption.id}>
                          {personaOption.label} · {personaOption.role}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="niuu-border-t niuu-border-border niuu-pt-6">
            <label className={SECTION_LABEL}>Add persona</label>
            <select
              className={cn(INPUT, 'niuu-mt-1')}
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return;
                onAddPersona(node.id, e.target.value, 40);
                e.currentTarget.value = '';
              }}
            >
              <option value="">Select a ravn…</option>
              {availablePersonas.map((persona) => (
                <option key={persona.id} value={persona.id}>
                  {persona.label} · {persona.role}
                </option>
                ))}
              </select>
          </div>

          <div className="niuu-border-t niuu-border-border niuu-pt-4">
            <button type="button" className={DELETE_BTN} onClick={() => onDeleteNode(node.id)}>
              Delete node
            </button>
          </div>
        </>
      )}

      {tab === 'validate' && (
        <div className="niuu-flex niuu-flex-col niuu-gap-2">
          {nodeIssues.length === 0 ? (
            <div className="niuu-rounded-md niuu-border niuu-border-status-emerald/40 niuu-bg-status-emerald/10 niuu-p-3 niuu-text-xs niuu-text-status-emerald">
              No validation issues on this node.
            </div>
          ) : (
            nodeIssues.map((issue, index) => (
              <div
                key={`${issue.kind}-${index}`}
                className={cn(
                  'niuu-rounded-xl niuu-border niuu-p-4 niuu-text-sm niuu-leading-relaxed',
                  issueTone(issue.severity),
                )}
              >
                <div className="niuu-font-semibold niuu-mb-1">{issue.kind}</div>
                <div>{issue.message}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function WorkflowDetailPanel({
  workflow,
  selectedNode,
  errorCount,
  warnCount,
  issues,
  personas,
  onDeleteNode,
  onUpdateNode,
  onUpdateLabel,
  onUpdateWorkflowMeta,
  onAddPersona,
  onReplacePersona,
  onUpdatePersonaBudget,
  onRemovePersona,
}: WorkflowDetailPanelProps) {
  const title = selectedNode ? selectedNode.label : 'Workflow';
  const subtitle = selectedNode
    ? `${selectedNode.kind} · ${selectedNode.id}`
    : 'Inspector and release summary';

  return (
    <div
      data-testid="workflow-detail-panel"
      className="niuu-w-[340px] niuu-shrink-0 niuu-border-l niuu-border-border niuu-bg-bg-secondary niuu-flex niuu-flex-col niuu-overflow-y-auto"
    >
      <div className="niuu-px-4 niuu-pt-3 niuu-pb-2 niuu-border-b niuu-border-border">
        <div className="niuu-flex niuu-flex-col niuu-gap-0.5">
          <span className="niuu-text-sm niuu-font-semibold niuu-text-text-primary niuu-font-sans">
            {title}
          </span>
          <span className="niuu-text-[10px] niuu-font-mono niuu-text-text-faint">{subtitle}</span>
        </div>
      </div>

      {selectedNode?.kind === 'stage' ? (
        <StageInspector
          node={selectedNode}
          workflow={workflow}
          personas={personas}
          issues={issues}
          onDeleteNode={onDeleteNode}
          onUpdateNode={onUpdateNode}
          onUpdateLabel={onUpdateLabel}
          onAddPersona={onAddPersona}
          onReplacePersona={onReplacePersona}
          onUpdatePersonaBudget={onUpdatePersonaBudget}
          onRemovePersona={onRemovePersona}
        />
      ) : selectedNode?.kind === 'gate' ? (
        <div className="niuu-px-4 niuu-py-3 niuu-flex niuu-flex-col niuu-gap-4">
          <div>
            <label className={SECTION_LABEL}>Gate name</label>
            <input
              className={INPUT}
              value={selectedNode.label}
              onChange={(e) => onUpdateLabel(selectedNode.id, e.target.value)}
            />
          </div>
          <div>
            <label className={SECTION_LABEL}>Condition</label>
            <textarea
              className={cn(INPUT, 'niuu-min-h-[84px]')}
              value={selectedNode.condition}
              onChange={(e) => onUpdateNode(selectedNode.id, { condition: e.target.value })}
            />
          </div>
          <div>
            <label className={SECTION_LABEL}>Approvers</label>
            <input
              className={INPUT}
              value={(selectedNode.approvers ?? []).join(', ')}
              onChange={(e) =>
                onUpdateNode(selectedNode.id, {
                  approvers: e.target.value
                    .split(',')
                    .map((part) => part.trim())
                    .filter(Boolean),
                })
              }
            />
          </div>
          <div>
            <label className={SECTION_LABEL}>Auto-forward after</label>
            <input
              className={INPUT}
              value={selectedNode.autoForwardAfter ?? '30m'}
              onChange={(e) =>
                onUpdateNode(selectedNode.id, { autoForwardAfter: e.target.value })
              }
            />
          </div>
        </div>
      ) : selectedNode?.kind === 'cond' ? (
        <div className="niuu-px-4 niuu-py-3 niuu-flex niuu-flex-col niuu-gap-4">
          <div>
            <label className={SECTION_LABEL}>Condition name</label>
            <input
              className={INPUT}
              value={selectedNode.label}
              onChange={(e) => onUpdateLabel(selectedNode.id, e.target.value)}
            />
          </div>
          <div>
            <label className={SECTION_LABEL}>Expression</label>
            <textarea
              className={cn(INPUT, 'niuu-min-h-[120px] niuu-font-mono')}
              value={selectedNode.predicate}
              onChange={(e) => onUpdateNode(selectedNode.id, { predicate: e.target.value })}
            />
          </div>
        </div>
      ) : selectedNode?.kind === 'trigger' ? (
        <div className="niuu-px-4 niuu-py-3 niuu-flex niuu-flex-col niuu-gap-4">
          <div>
            <label className={SECTION_LABEL}>Trigger label</label>
            <input
              className={INPUT}
              value={selectedNode.label}
              onChange={(e) => onUpdateLabel(selectedNode.id, e.target.value)}
            />
          </div>
          <div>
            <label className={SECTION_LABEL}>Source event</label>
            <input
              className={cn(INPUT, 'niuu-font-mono')}
              value={selectedNode.source ?? 'manual dispatch'}
              onChange={(e) => onUpdateNode(selectedNode.id, { source: e.target.value })}
            />
          </div>
        </div>
      ) : selectedNode?.kind === 'end' ? (
        <div className="niuu-px-4 niuu-py-3 niuu-flex niuu-flex-col niuu-gap-4">
          <div>
            <label className={SECTION_LABEL}>End label</label>
            <input
              className={INPUT}
              value={selectedNode.label}
              onChange={(e) => onUpdateLabel(selectedNode.id, e.target.value)}
            />
          </div>
          <div className="niuu-rounded-md niuu-border niuu-border-border-subtle niuu-bg-bg-elevated niuu-p-3 niuu-text-xs niuu-text-text-secondary">
            Terminal node. Use this to make completion paths explicit in the graph and pipeline views.
          </div>
        </div>
      ) : (
        <WorkflowSummary
          workflow={workflow}
          errorCount={errorCount}
          warnCount={warnCount}
          onUpdateWorkflowMeta={onUpdateWorkflowMeta}
        />
      )}
    </div>
  );
}

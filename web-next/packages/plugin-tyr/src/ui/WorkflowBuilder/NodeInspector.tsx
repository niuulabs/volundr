/**
 * NodeInspector — Dialog showing details for a right-clicked workflow node.
 *
 * Displays node kind, label, and kind-specific properties.
 * For stage nodes, shows assigned personas and raid linkage.
 *
 * Owner: plugin-tyr (WorkflowBuilder).
 */

import { Dialog, DialogContent } from '@niuulabs/ui';
import type { WorkflowNode } from '../../domain/workflow';
import type { WorkflowBuilderActions } from './useWorkflowBuilder';

export interface NodeInspectorProps {
  node: WorkflowNode;
  onClose: () => void;
  onUpdateLabel: WorkflowBuilderActions['updateNodeLabel'];
  onAddPersona: WorkflowBuilderActions['addPersonaToStage'];
  onRemovePersona: WorkflowBuilderActions['removePersonaFromStage'];
}

export function NodeInspector({ node, onClose, onUpdateLabel, onAddPersona, onRemovePersona }: NodeInspectorProps) {
  const kindLabel = node.kind === 'stage' ? 'Stage' : node.kind === 'gate' ? 'Gate' : 'Condition';

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        title={`${kindLabel}: ${node.label}`}
        description={`Node ID: ${node.id}`}
      >
        <div data-testid="node-inspector" style={{ fontFamily: 'var(--font-sans)', fontSize: 13 }}>
          {/* Kind badge */}
          <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                color: node.kind === 'stage' ? 'var(--color-brand)' : node.kind === 'gate' ? 'var(--color-accent-amber)' : 'var(--color-accent-cyan)',
                background: 'var(--color-bg-elevated)',
                padding: '2px 8px',
                borderRadius: 4,
              }}
            >
              {kindLabel}
            </span>
          </div>

          {/* Label editor */}
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>
              Label
            </span>
            <input
              data-testid="inspector-label"
              defaultValue={node.label}
              onBlur={(e) => onUpdateLabel(node.id, e.currentTarget.value)}
              style={{
                width: '100%',
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                borderRadius: 4,
                padding: '6px 8px',
                color: 'var(--color-text-primary)',
                fontSize: 13,
                fontFamily: 'var(--font-sans)',
                boxSizing: 'border-box',
              }}
            />
          </label>

          {/* Kind-specific fields */}
          {node.kind === 'gate' && (
            <div style={{ marginBottom: 12 }}>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                Condition
              </span>
              <div
                data-testid="inspector-condition"
                style={{
                  background: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 4,
                  padding: '6px 8px',
                  color: 'var(--color-text-secondary)',
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {node.condition || <em style={{ color: 'var(--color-text-muted)' }}>not set</em>}
              </div>
            </div>
          )}

          {node.kind === 'cond' && (
            <div style={{ marginBottom: 12 }}>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                Predicate
              </span>
              <div
                data-testid="inspector-predicate"
                style={{
                  background: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 4,
                  padding: '6px 8px',
                  color: 'var(--color-text-secondary)',
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {node.predicate || <em style={{ color: 'var(--color-text-muted)' }}>not set</em>}
              </div>
            </div>
          )}

          {node.kind === 'stage' && (
            <>
              {/* Raid linkage */}
              <div style={{ marginBottom: 12 }}>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                  Raid ID
                </span>
                <div
                  data-testid="inspector-raid-id"
                  style={{
                    background: 'var(--color-bg-secondary)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 4,
                    padding: '6px 8px',
                    color: node.raidId ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
                    fontSize: 12,
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {node.raidId ?? 'unassigned'}
                </div>
              </div>

              {/* Personas */}
              <div style={{ marginBottom: 12 }}>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                  Personas
                </span>
                {node.personaIds.length === 0 ? (
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>None assigned</div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {node.personaIds.map((pid) => (
                      <span
                        key={pid}
                        data-testid={`inspector-persona-${pid}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          background: 'var(--color-bg-elevated)',
                          border: '1px solid var(--color-border)',
                          borderRadius: 4,
                          padding: '2px 8px',
                          fontSize: 12,
                          color: 'var(--color-text-primary)',
                          fontFamily: 'var(--font-sans)',
                        }}
                      >
                        {pid}
                        <button
                          data-testid={`remove-persona-${pid}`}
                          onClick={() => onRemovePersona(node.id, pid)}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--color-text-muted)',
                            padding: 0,
                            fontSize: 12,
                            lineHeight: 1,
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

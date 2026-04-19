/**
 * YamlView — read-only pretty-printed YAML of the Workflow DAG.
 *
 * Uses the custom `workflowToYaml` serialiser from graphUtils.
 * No external YAML library dependency.
 *
 * Owner: plugin-tyr (WorkflowBuilder).
 */

import type { Workflow } from '../../domain/workflow';
import { workflowToYaml } from './graphUtils';

export interface YamlViewProps {
  workflow: Workflow;
}

export function YamlView({ workflow }: YamlViewProps) {
  const yaml = workflowToYaml(workflow);

  return (
    <div
      data-testid="yaml-view"
      style={{
        flex: 1,
        overflow: 'auto',
        background: 'var(--color-bg-primary)',
      }}
    >
      <pre
        data-testid="yaml-content"
        style={{
          margin: 0,
          padding: 24,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          lineHeight: 1.6,
          color: 'var(--color-text-secondary)',
          whiteSpace: 'pre',
        }}
      >
        {yaml}
      </pre>
    </div>
  );
}

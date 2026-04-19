import { usePersonaYaml } from './usePersona';

export interface PersonaYamlProps {
  name: string;
}

export function PersonaYaml({ name }: PersonaYamlProps) {
  const { data, isLoading, isError, error } = usePersonaYaml(name);

  if (isLoading) {
    return (
      <div
        data-testid="persona-yaml-loading"
        className="niuu-p-6 niuu-text-sm niuu-text-text-muted"
      >
        Loading YAML…
      </div>
    );
  }

  if (isError) {
    return (
      <div data-testid="persona-yaml-error" className="niuu-p-6 niuu-text-sm niuu-text-critical">
        {error instanceof Error ? error.message : 'Failed to load YAML'}
      </div>
    );
  }

  return (
    <div className="niuu-overflow-auto niuu-h-full niuu-p-6" data-testid="persona-yaml">
      <pre className="niuu-m-0 niuu-font-mono niuu-text-xs niuu-text-text-secondary niuu-whitespace-pre-wrap niuu-leading-relaxed">
        {data}
      </pre>
    </div>
  );
}

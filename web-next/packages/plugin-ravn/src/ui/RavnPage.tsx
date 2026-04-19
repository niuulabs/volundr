import { Rune, StateDot } from '@niuulabs/ui';
import { usePersonas } from './usePersonas';

export function RavnPage() {
  const { data, isLoading, isError, error } = usePersonas();

  return (
    <div className="niuu-p-6 niuu-max-w-[720px]">
      <div className="niuu-flex niuu-items-center niuu-gap-3 niuu-mb-4">
        <Rune glyph="ᚱ" size={32} />
        <h2 className="niuu-m-0">ravn · personas · ravens · sessions</h2>
      </div>

      <p className="niuu-text-text-secondary">
        Ravn is the canonical authority for Persona, ToolRegistry, EventCatalog, and BudgetState.
        This placeholder will be replaced by the full Ravn UI.
      </p>

      {isLoading && (
        <div className="niuu-flex niuu-items-center niuu-gap-2" role="status">
          <StateDot state="processing" pulse />
          <span>loading personas…</span>
        </div>
      )}

      {isError && (
        <div className="niuu-flex niuu-items-center niuu-gap-2" role="alert">
          <StateDot state="failed" />
          <span>{error instanceof Error ? error.message : 'unknown error'}</span>
        </div>
      )}

      {data && (
        <p className="niuu-text-text-secondary">
          {data.length} persona{data.length !== 1 ? 's' : ''} loaded.
        </p>
      )}
    </div>
  );
}

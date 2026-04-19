import { Rune, StateDot } from '@niuulabs/ui';
import { useTopology } from '../application/useTopology';
import { useEvents } from '../application/useEvents';
import type { EventSeverity } from '../domain';

function severityToDotState(severity: EventSeverity) {
  if (severity === 'error') return 'failed' as const;
  if (severity === 'warn') return 'attention' as const;
  if (severity === 'debug') return 'idle' as const;
  return 'healthy' as const;
}

export function ObservatoryPage() {
  const topology = useTopology();
  const events = useEvents();

  const nodeCount = topology?.nodes.length ?? 0;
  const edgeCount = topology?.edges.length ?? 0;
  const recentEvents = events.slice(-5);

  return (
    <div className="niuu-p-6 niuu-max-w-[960px]">
      <div className="niuu-flex niuu-items-center niuu-gap-3 niuu-mb-2">
        <Rune glyph="ᚠ" size={32} />
        <h2 className="niuu-m-0">Observatory</h2>
      </div>
      <p className="niuu-m-0 niuu-mb-6 niuu-text-text-secondary">
        live topology · canvas coming soon
      </p>

      {topology ? (
        <div className="niuu-flex niuu-gap-4 niuu-mb-6">
          <StatCard label="nodes" value={nodeCount} />
          <StatCard label="edges" value={edgeCount} />
        </div>
      ) : (
        <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-mb-6">
          <StateDot state="processing" pulse />
          <span>connecting…</span>
        </div>
      )}

      {recentEvents.length > 0 && (
        <section>
          <h3 className="niuu-m-0 niuu-mb-3 niuu-text-sm niuu-text-text-muted">Recent events</h3>
          <ul className="niuu-list-none niuu-p-0 niuu-grid niuu-gap-2">
            {recentEvents.map((ev) => (
              <li
                key={ev.id}
                className="niuu-flex niuu-items-center niuu-gap-2 niuu-py-2 niuu-px-3 niuu-border niuu-border-border-subtle niuu-rounded-md niuu-bg-bg-secondary niuu-text-sm"
              >
                <StateDot state={severityToDotState(ev.severity)} />
                <span className="niuu-text-text-muted niuu-font-mono">{ev.sourceId}</span>
                <span className="niuu-flex-1">{ev.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="niuu-p-4 niuu-border niuu-border-border-subtle niuu-rounded-md niuu-bg-bg-secondary niuu-min-w-[100px]">
      <div className="niuu-text-2xl niuu-font-bold">{value}</div>
      <div className="niuu-text-text-muted niuu-text-xs">{label}</div>
    </div>
  );
}

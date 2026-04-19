import { useTopology } from '../application/useTopology';
import { TopologyCanvas } from './TopologyCanvas';

/**
 * Observatory page — full-viewport topology canvas.
 *
 * Data is sourced from the live topology stream via useTopology().
 * The canvas renders Mímir at (0,0), realms around it, clusters inside
 * realms, hosts on the perimeter, and all 5 connection-line kinds.
 */
export function ObservatoryPage() {
  const topology = useTopology();

  return (
    <div
      data-testid="observatory-page"
      style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}
    >
      <TopologyCanvas topology={topology} showMinimap style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}

import { useState } from 'react';
import { useTopology } from '../application/useTopology';
import { useEvents } from '../application/useEvents';
import { useRegistry } from '../application/useRegistry';
import type { TopologyNode } from '../domain';
import { TopologyCanvas } from './TopologyCanvas';
import { EntityDrawer } from './overlays/EntityDrawer';
import { EventLog } from './overlays/EventLog';
import { ConnectionLegend } from './overlays/ConnectionLegend';
import { Minimap } from './overlays/Minimap';

/**
 * Observatory page — full-viewport topology canvas.
 *
 * Data is sourced from the live topology stream via useTopology().
 * The canvas renders Mímir at (0,0), realms around it, clusters inside
 * realms, hosts on the perimeter, and all 5 connection-line kinds.
 */
export function ObservatoryPage() {
  const topology = useTopology();
  const events = useEvents();
  const { data: registry } = useRegistry();
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null);

  function handleNodeClick(nodeId: string) {
    const node = topology?.nodes.find((n) => n.id === nodeId) ?? null;
    setSelectedNode(node);
  }

  return (
    <div
      data-testid="observatory-page"
      style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}
    >
      <TopologyCanvas
        topology={topology}
        onNodeClick={handleNodeClick}
        showMinimap
        style={{ flex: 1, minHeight: 0 }}
      />

      {/* Node list positioned off-screen — interim click target until canvas hit-testing
          is available in JSDOM tests (NIU-664). Invisible to sighted users. */}
      {topology && topology.nodes.length > 0 && (
        <ul
          style={{ position: 'absolute', left: '-9999px' }}
          data-testid="topology-node-list"
          aria-hidden="true"
        >
          {topology.nodes.map((node) => (
            <li key={node.id}>
              <button
                onClick={() => setSelectedNode(node)}
                data-testid={`node-btn-${node.id}`}
                data-node-type={node.typeId}
              >
                {node.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Canvas overlays */}
      <ConnectionLegend />
      <Minimap topology={topology} selectedNodeId={selectedNode?.id} />
      <EventLog events={events} />
      <EntityDrawer
        node={selectedNode}
        topology={topology}
        registry={registry ?? null}
        onClose={() => setSelectedNode(null)}
        onNodeSelect={(n) => setSelectedNode(n)}
      />
    </div>
  );
}

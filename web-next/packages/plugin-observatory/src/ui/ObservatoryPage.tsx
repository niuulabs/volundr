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
        showMinimap={false}
        style={{ flex: 1, minHeight: 0 }}
      />

      {/* Node list — 1px click targets stacked at top-left with z-index above the
          canvas. Interim mechanism until canvas hit-testing is connected (NIU-664). */}
      {topology && topology.nodes.length > 0 && (
        <ul
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            zIndex: 9999,
            listStyle: 'none',
            padding: 0,
            margin: 0,
          }}
          data-testid="topology-node-list"
        >
          {topology.nodes.map((node) => (
            <li key={node.id}>
              <button
                style={{
                  width: 1,
                  height: 1,
                  padding: 0,
                  overflow: 'hidden',
                  border: 'none',
                  background: 'none',
                  cursor: 'default',
                }}
                onClick={() => setSelectedNode(node)}
                data-testid={`node-btn-${node.id}`}
                data-node-type={node.typeId}
                aria-label={node.label}
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

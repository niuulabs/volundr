import { Drawer, DrawerContent, Sparkline, StateDot } from '@niuulabs/ui';
import type { DotState } from '@niuulabs/ui';
import type { TopologyNode, Topology, Registry } from '../../domain';
import './EntityDrawer.css';

export interface EntityDrawerProps {
  /** The node to display in the drawer. Null means drawer is closed. */
  node: TopologyNode | null;
  topology: Topology | null;
  registry: Registry | null;
  onClose: () => void;
  onNodeSelect?: (node: TopologyNode) => void;
}

const CONTAINER_KINDS = new Set(['realm', 'cluster', 'host']);

export function EntityDrawer({
  node,
  topology,
  registry,
  onClose,
  onNodeSelect,
}: EntityDrawerProps) {
  const entityType = node ? registry?.types.find((t) => t.id === node.typeId) : undefined;
  const residents = node && topology ? topology.nodes.filter((n) => n.parentId === node.id) : [];
  const isContainerKind = node ? CONTAINER_KINDS.has(node.typeId) : false;

  return (
    <Drawer
      open={node !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {node && (
        <DrawerContent title={node.label} width={360}>
          {/* HEAD — rune · label · status · sparkline */}
          <div className="obs-entity-drawer__head">
            <div className="obs-entity-drawer__identity">
              {entityType && (
                <span className="obs-entity-drawer__rune" aria-hidden="true">
                  {entityType.rune}
                </span>
              )}
              <div className="obs-entity-drawer__meta">
                <span className="obs-entity-drawer__type-label">
                  {entityType?.label ?? node.typeId}
                </span>
                <div className="obs-entity-drawer__status">
                  <StateDot state={node.status as DotState} />
                  <span className="obs-entity-drawer__status-text">{node.status}</span>
                </div>
              </div>
            </div>
            <Sparkline id={node.id} width={120} height={28} />
          </div>

          {/* BODY */}
          <div className="obs-entity-drawer__body">
            {entityType?.description && (
              <p className="obs-entity-drawer__description">{entityType.description}</p>
            )}

            {isContainerKind && residents.length > 0 && (
              <section className="obs-entity-drawer__section">
                <h4 className="obs-entity-drawer__section-title">Residents</h4>
                <ul className="obs-entity-drawer__resident-list">
                  {residents.map((resident) => {
                    const residentType = registry?.types.find((t) => t.id === resident.typeId);
                    return (
                      <li key={resident.id}>
                        <button
                          className="obs-entity-drawer__resident-btn"
                          onClick={() => onNodeSelect?.(resident)}
                          data-testid={`resident-${resident.id}`}
                        >
                          {residentType && (
                            <span className="obs-entity-drawer__resident-rune" aria-hidden="true">
                              {residentType.rune}
                            </span>
                          )}
                          <span className="obs-entity-drawer__resident-label">
                            {resident.label}
                          </span>
                          <StateDot state={resident.status as DotState} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {!isContainerKind && entityType && entityType.fields.length > 0 && (
              <section className="obs-entity-drawer__section">
                <h4 className="obs-entity-drawer__section-title">Fields</h4>
                <ul className="obs-entity-drawer__field-list">
                  {entityType.fields.map((field) => (
                    <li key={field.key} className="obs-entity-drawer__field">
                      <span className="obs-entity-drawer__field-label">{field.label}</span>
                      <span className="obs-entity-drawer__field-type">{field.type}</span>
                      {field.required && (
                        <span className="obs-entity-drawer__field-required" aria-label="required">
                          *
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </DrawerContent>
      )}
    </Drawer>
  );
}

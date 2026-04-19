/**
 * GraphView — interactive pan/zoom SVG canvas.
 *
 * Renders WorkflowNodes as SVG shapes and WorkflowEdges as bezier curves.
 * Supports:
 *  • Mouse-drag pan on the canvas background
 *  • Scroll-wheel zoom (clamped 0.3×–3×)
 *  • Node drag-to-reposition
 *  • Click to select
 *  • Right-click to open Inspector
 *  • "Connect" button on selected node to draw edges
 *  • Add-node toolbar
 *  • Delete-node button on selected node
 *
 * Owner: plugin-tyr (WorkflowBuilder).
 */

import { useRef, useState, useEffect } from 'react';
import type { WorkflowNode, WorkflowEdge } from '../../domain/workflow';
import type { WorkflowBuilderActions } from './useWorkflowBuilder';
import { STAGE_WIDTH, STAGE_HEIGHT, GATE_SIZE, COND_RADIUS, edgeToPath } from './graphUtils';

// ---------------------------------------------------------------------------
// Zoom / pan constants
// ---------------------------------------------------------------------------

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3.0;

// ---------------------------------------------------------------------------
// Colour palette (CSS variables)
// ---------------------------------------------------------------------------

const C = {
  bg: 'var(--color-bg-primary)',
  nodeStroke: 'var(--color-border)',
  nodeStrokeSelected: 'var(--color-brand)',
  nodeFill: 'var(--color-bg-secondary)',
  nodeFillConnecting: 'var(--color-bg-elevated)',
  text: 'var(--color-text-primary)',
  textMuted: 'var(--color-text-secondary)',
  edgeStroke: 'var(--color-border)',
  edgeStrokeHover: 'var(--color-text-secondary)',
  gate: 'color-mix(in srgb, var(--color-accent-amber) 20%, var(--color-bg-secondary))',
  gateStroke: 'var(--color-accent-amber)',
  cond: 'color-mix(in srgb, var(--color-accent-cyan) 20%, var(--color-bg-secondary))',
  condStroke: 'var(--color-accent-cyan)',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface NodeProps {
  node: WorkflowNode;
  selected: boolean;
  connecting: boolean;
  onSelect: () => void;
  onInspect: () => void;
  onStartConnect: () => void;
  onCompleteConnect: () => void;
  onDelete: () => void;
  onDragEnd: (position: { x: number; y: number }) => void;
  isConnectingMode: boolean;
}

function StageNode({ node, selected, connecting: _connecting, onSelect, onInspect, onStartConnect, onCompleteConnect, onDelete, onDragEnd, isConnectingMode }: NodeProps) {
  const dragRef = useRef<{ startX: number; startY: number; nx: number; ny: number } | null>(null);
  const { x, y } = node.position;
  const fill = selected ? 'var(--color-bg-elevated)' : C.nodeFill;
  const stroke = selected ? C.nodeStrokeSelected : C.nodeStroke;
  const sw = selected ? 2 : 1;

  function handleMouseDown(e: React.MouseEvent) {
    e.stopPropagation();
    if (isConnectingMode) {
      onCompleteConnect();
      return;
    }
    dragRef.current = { startX: e.clientX, startY: e.clientY, nx: x, ny: y };
    onSelect();
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      onDragEnd({ x: dragRef.current.nx + dx, y: dragRef.current.ny + dy });
    }
  }

  function handleMouseUp() {
    dragRef.current = null;
  }

  return (
    <g
      data-testid={`workflow-node-${node.id}`}
      data-kind="stage"
      data-selected={selected ? 'true' : undefined}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={(e) => { e.preventDefault(); onInspect(); }}
      style={{ cursor: isConnectingMode ? 'crosshair' : 'grab' }}
    >
      <rect
        x={x}
        y={y}
        width={STAGE_WIDTH}
        height={STAGE_HEIGHT}
        rx={6}
        fill={fill}
        stroke={stroke}
        strokeWidth={sw}
      />
      <text
        x={x + STAGE_WIDTH / 2}
        y={y + STAGE_HEIGHT / 2 - 6}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={C.text}
        fontSize={12}
        fontFamily="var(--font-sans)"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {node.kind === 'stage' && node.label.length > 18 ? node.label.slice(0, 16) + '…' : node.label}
      </text>
      {node.kind === 'stage' && node.personaIds.length > 0 && (
        <text
          x={x + STAGE_WIDTH / 2}
          y={y + STAGE_HEIGHT / 2 + 10}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={C.textMuted}
          fontSize={9}
          fontFamily="var(--font-sans)"
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {node.kind === 'stage' ? `${node.personaIds.length} persona${node.personaIds.length !== 1 ? 's' : ''}` : ''}
        </text>
      )}
      {selected && !isConnectingMode && (
        <>
          {/* Connect button */}
          <g
            data-testid={`connect-btn-${node.id}`}
            onClick={(e) => { e.stopPropagation(); onStartConnect(); }}
            style={{ cursor: 'pointer' }}
          >
            <circle cx={x + STAGE_WIDTH + 10} cy={y + STAGE_HEIGHT / 2} r={8} fill="var(--color-brand)" />
            <text x={x + STAGE_WIDTH + 10} y={y + STAGE_HEIGHT / 2} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize={12} style={{ pointerEvents: 'none' }}>→</text>
          </g>
          {/* Delete button */}
          <g
            data-testid={`delete-btn-${node.id}`}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            style={{ cursor: 'pointer' }}
          >
            <circle cx={x + STAGE_WIDTH / 2} cy={y - 10} r={7} fill="var(--color-critical)" />
            <text x={x + STAGE_WIDTH / 2} y={y - 10} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize={10} style={{ pointerEvents: 'none' }}>×</text>
          </g>
        </>
      )}
      {/* Drop target overlay for persona drag */}
      <rect
        data-testid={`stage-drop-${node.id}`}
        x={x}
        y={y}
        width={STAGE_WIDTH}
        height={STAGE_HEIGHT}
        fill="transparent"
        style={{ pointerEvents: 'none' }}
      />
    </g>
  );
}

function GateNode({ node, selected, onSelect, onInspect, onStartConnect, onCompleteConnect, onDelete, onDragEnd, isConnectingMode }: NodeProps) {
  const dragRef = useRef<{ startX: number; startY: number; nx: number; ny: number } | null>(null);
  const { x, y } = node.position;
  const H = GATE_SIZE / 2;
  const stroke = selected ? C.nodeStrokeSelected : C.gateStroke;
  const sw = selected ? 2 : 1;
  const cx = x + H;
  const cy = y + H;

  function handleMouseDown(e: React.MouseEvent) {
    e.stopPropagation();
    if (isConnectingMode) { onCompleteConnect(); return; }
    dragRef.current = { startX: e.clientX, startY: e.clientY, nx: x, ny: y };
    onSelect();
  }
  function handleMouseMove(e: React.MouseEvent) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      onDragEnd({ x: dragRef.current.nx + dx, y: dragRef.current.ny + dy });
    }
  }

  return (
    <g
      data-testid={`workflow-node-${node.id}`}
      data-kind="gate"
      data-selected={selected ? 'true' : undefined}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={() => { dragRef.current = null; }}
      onContextMenu={(e) => { e.preventDefault(); onInspect(); }}
      style={{ cursor: isConnectingMode ? 'crosshair' : 'grab' }}
    >
      <path
        d={`M ${cx} ${y} L ${x + GATE_SIZE} ${cy} L ${cx} ${y + GATE_SIZE} L ${x} ${cy} Z`}
        fill={C.gate}
        stroke={stroke}
        strokeWidth={sw}
      />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fill={C.text} fontSize={11} fontFamily="var(--font-sans)" style={{ pointerEvents: 'none', userSelect: 'none' }}>
        {node.label.length > 8 ? node.label.slice(0, 7) + '…' : node.label}
      </text>
      {selected && !isConnectingMode && (
        <>
          <g data-testid={`connect-btn-${node.id}`} onClick={(e) => { e.stopPropagation(); onStartConnect(); }} style={{ cursor: 'pointer' }}>
            <circle cx={x + GATE_SIZE + 10} cy={cy} r={8} fill="var(--color-brand)" />
            <text x={x + GATE_SIZE + 10} y={cy} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize={12} style={{ pointerEvents: 'none' }}>→</text>
          </g>
          <g data-testid={`delete-btn-${node.id}`} onClick={(e) => { e.stopPropagation(); onDelete(); }} style={{ cursor: 'pointer' }}>
            <circle cx={cx} cy={y - 10} r={7} fill="var(--color-critical)" />
            <text x={cx} y={y - 10} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize={10} style={{ pointerEvents: 'none' }}>×</text>
          </g>
        </>
      )}
    </g>
  );
}

function CondNode({ node, selected, onSelect, onInspect, onStartConnect, onCompleteConnect, onDelete, onDragEnd, isConnectingMode }: NodeProps) {
  const dragRef = useRef<{ startX: number; startY: number; nx: number; ny: number } | null>(null);
  const { x, y } = node.position;
  const cx = x + COND_RADIUS;
  const cy = y + COND_RADIUS;
  const stroke = selected ? C.nodeStrokeSelected : C.condStroke;
  const sw = selected ? 2 : 1;

  function handleMouseDown(e: React.MouseEvent) {
    e.stopPropagation();
    if (isConnectingMode) { onCompleteConnect(); return; }
    dragRef.current = { startX: e.clientX, startY: e.clientY, nx: x, ny: y };
    onSelect();
  }
  function handleMouseMove(e: React.MouseEvent) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      onDragEnd({ x: dragRef.current.nx + dx, y: dragRef.current.ny + dy });
    }
  }

  return (
    <g
      data-testid={`workflow-node-${node.id}`}
      data-kind="cond"
      data-selected={selected ? 'true' : undefined}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={() => { dragRef.current = null; }}
      onContextMenu={(e) => { e.preventDefault(); onInspect(); }}
      style={{ cursor: isConnectingMode ? 'crosshair' : 'grab' }}
    >
      <circle cx={cx} cy={cy} r={COND_RADIUS} fill={C.cond} stroke={stroke} strokeWidth={sw} />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fill={C.text} fontSize={10} fontFamily="var(--font-sans)" style={{ pointerEvents: 'none', userSelect: 'none' }}>
        {node.label.length > 6 ? node.label.slice(0, 5) + '…' : node.label}
      </text>
      {selected && !isConnectingMode && (
        <>
          <g data-testid={`connect-btn-${node.id}`} onClick={(e) => { e.stopPropagation(); onStartConnect(); }} style={{ cursor: 'pointer' }}>
            <circle cx={cx + COND_RADIUS + 10} cy={cy} r={8} fill="var(--color-brand)" />
            <text x={cx + COND_RADIUS + 10} y={cy} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize={12} style={{ pointerEvents: 'none' }}>→</text>
          </g>
          <g data-testid={`delete-btn-${node.id}`} onClick={(e) => { e.stopPropagation(); onDelete(); }} style={{ cursor: 'pointer' }}>
            <circle cx={cx} cy={cy - COND_RADIUS - 10} r={7} fill="var(--color-critical)" />
            <text x={cx} y={cy - COND_RADIUS - 10} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize={10} style={{ pointerEvents: 'none' }}>×</text>
          </g>
        </>
      )}
    </g>
  );
}

function WorkflowEdgePath({ edge, nodes }: { edge: WorkflowEdge; nodes: Map<string, WorkflowNode> }) {
  const d = edgeToPath(edge, nodes);
  if (!d) return null;
  return (
    <g data-testid={`workflow-edge-${edge.id}`}>
      <path d={d} fill="none" stroke={C.edgeStroke} strokeWidth={1.5} markerEnd="url(#arrowhead)" />
      {edge.label && (
        <text
          // midpoint approximation
          x={(() => {
            const src = nodes.get(edge.source);
            const tgt = nodes.get(edge.target);
            if (!src || !tgt) return 0;
            return (src.position.x + tgt.position.x) / 2;
          })()}
          y={(() => {
            const src = nodes.get(edge.source);
            const tgt = nodes.get(edge.target);
            if (!src || !tgt) return 0;
            return (src.position.y + tgt.position.y) / 2 - 8;
          })()}
          textAnchor="middle"
          fill={C.textMuted}
          fontSize={10}
          fontFamily="var(--font-sans)"
        >
          {edge.label}
        </text>
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// GraphView
// ---------------------------------------------------------------------------

export interface GraphViewProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  selectedNodeId: string | null;
  connectingFromId: string | null;
  onSelectNode: WorkflowBuilderActions['selectNode'];
  onInspectNode: WorkflowBuilderActions['inspectNode'];
  onAddNode: WorkflowBuilderActions['addNode'];
  onDeleteNode: WorkflowBuilderActions['deleteNode'];
  onMoveNode: WorkflowBuilderActions['moveNode'];
  onStartConnect: WorkflowBuilderActions['startConnect'];
  onCancelConnect: WorkflowBuilderActions['cancelConnect'];
  onCompleteConnect: WorkflowBuilderActions['completeConnect'];
}

export function GraphView({
  nodes,
  edges,
  selectedNodeId,
  connectingFromId,
  onSelectNode,
  onInspectNode,
  onAddNode,
  onDeleteNode,
  onMoveNode,
  onStartConnect,
  onCancelConnect,
  onCompleteConnect,
}: GraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const panRef = useRef<{ startX: number; startY: number; tx: number; ty: number } | null>(null);

  const nodeMap = new Map<string, WorkflowNode>(nodes.map((n) => [n.id, n]));
  const isConnectingMode = connectingFromId !== null;

  // Wheel zoom
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      setTransform((prev) => {
        const delta = e.deltaY < 0 ? 1.1 : 0.9;
        const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.scale * delta));
        return { ...prev, scale: newScale };
      });
    }
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  // Key handler for Escape (cancel connect) and Delete (delete selected)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancelConnect();
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
        onDeleteNode(selectedNodeId);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancelConnect, onDeleteNode, selectedNodeId]);

  function handleSvgMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    if ((e.target as Element).closest('[data-testid^="workflow-node"]')) return;
    if (isConnectingMode) { onCancelConnect(); return; }
    onSelectNode(null);
    panRef.current = { startX: e.clientX, startY: e.clientY, tx: transform.x, ty: transform.y };
  }

  function handleSvgMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!panRef.current) return;
    setTransform((prev) => ({
      ...prev,
      x: panRef.current!.tx + (e.clientX - panRef.current!.startX),
      y: panRef.current!.ty + (e.clientY - panRef.current!.startY),
    }));
  }

  function handleSvgMouseUp() {
    panRef.current = null;
  }

  const nodeProps = (node: WorkflowNode) => ({
    node,
    selected: node.id === selectedNodeId,
    connecting: node.id === connectingFromId,
    isConnectingMode,
    onSelect: () => onSelectNode(node.id),
    onInspect: () => onInspectNode(node.id),
    onStartConnect: () => onStartConnect(node.id),
    onCompleteConnect: () => onCompleteConnect(node.id),
    onDelete: () => onDeleteNode(node.id),
    onDragEnd: (pos: { x: number; y: number }) => onMoveNode(node.id, pos),
  });

  return (
    <div
      data-testid="graph-view"
      style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        background: C.bg,
        minHeight: 400,
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 8,
          zIndex: 10,
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          padding: '6px 10px',
        }}
      >
        <button
          data-testid="add-stage"
          onClick={() => onAddNode('stage')}
          style={toolbarBtn}
          title="Add stage node"
        >
          + Stage
        </button>
        <button
          data-testid="add-gate"
          onClick={() => onAddNode('gate')}
          style={toolbarBtn}
          title="Add gate node"
        >
          ◇ Gate
        </button>
        <button
          data-testid="add-cond"
          onClick={() => onAddNode('cond')}
          style={toolbarBtn}
          title="Add condition node"
        >
          ○ Cond
        </button>
        {selectedNodeId && (
          <button
            data-testid="delete-selected"
            onClick={() => onDeleteNode(selectedNodeId)}
            style={{ ...toolbarBtn, color: 'var(--color-critical)' }}
            title="Delete selected node"
          >
            Delete
          </button>
        )}
        {isConnectingMode && (
          <span style={{ color: 'var(--color-text-secondary)', fontSize: 12, alignSelf: 'center' }}>
            Click target node…
          </span>
        )}
      </div>

      {/* SVG Canvas */}
      <svg
        ref={svgRef}
        data-testid="graph-canvas"
        style={{ width: '100%', height: '100%', cursor: isConnectingMode ? 'crosshair' : panRef.current ? 'grabbing' : 'default' }}
        onMouseDown={handleSvgMouseDown}
        onMouseMove={handleSvgMouseMove}
        onMouseUp={handleSvgMouseUp}
        onMouseLeave={handleSvgMouseUp}
      >
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill={C.edgeStroke} />
          </marker>
        </defs>
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}>
          {/* Edges (drawn first, below nodes) */}
          {edges.map((edge) => (
            <WorkflowEdgePath key={edge.id} edge={edge} nodes={nodeMap} />
          ))}
          {/* Nodes */}
          {nodes.map((node) => {
            const props = nodeProps(node);
            switch (node.kind) {
              case 'stage':
                return <StageNode key={node.id} {...props} />;
              case 'gate':
                return <GateNode key={node.id} {...props} />;
              case 'cond':
                return <CondNode key={node.id} {...props} />;
            }
          })}
        </g>
      </svg>
    </div>
  );
}

const toolbarBtn: React.CSSProperties = {
  background: 'var(--color-bg-elevated)',
  color: 'var(--color-text-primary)',
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  padding: '4px 10px',
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
};

export interface GraphNode {
  id: string;
  title: string;
  category: string;
  /** Number of inbound edges — set during graph processing */
  inboundCount?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface MimirGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

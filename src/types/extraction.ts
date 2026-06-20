export interface GraphNode {
  id: string;
  label: string;
  type: string;
  fileType: string;
  sourceFile: string;
  sourceLocation?: string;
  community?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  label?: string;
  confidence?: string;
  confidenceScore?: number;
  sourceFile?: string;
}

export interface RawCall {
  sourceId: string;
  targetId: string;
  targetName: string;
  sourceFile: string;
  sourceLocation?: string;
}

export interface Hyperedge {
  id: string;
  label?: string;
  nodes: string[];
  confidence?: string;
  confidenceScore?: number;
}

export interface ExtractionResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  languages: Record<string, unknown>;
  error?: string;
}

export interface GodNode {
  id: string;
  label: string;
  degree: number;
}

export type ConfidenceLevel = "EXTRACTED" | "INFERRED" | "AMBIGUOUS";

export interface SurprisingConnection {
  source: string;
  target: string;
  sourceFiles: [string, string];
  confidence: ConfidenceLevel;
  relation: string;
  note?: string;
  why?: string;
  confidenceScore?: number;
}

export type QuestionType =
  | "ambiguous_edge"
  | "bridge_node"
  | "isolated_nodes"
  | "low_cohesion"
  | "no_signal";

export interface SuggestedQuestion {
  type: QuestionType;
  question: string | null;
  why: string;
}

export interface DiffNodeEntry {
  id: string;
  label: string;
}

export interface DiffEdgeEntry {
  source: string;
  target: string;
  relation: string;
  confidence: string;
}

export interface GraphDiff {
  newNodes: DiffNodeEntry[];
  removedNodes: DiffNodeEntry[];
  newEdges: DiffEdgeEntry[];
  removedEdges: DiffEdgeEntry[];
  summary: string;
}

export interface ImportCycle {
  cycle: string[];
  length: number;
  why: string;
}

export interface NodeAttributes {
  id: string;
  label: string;
  type?: string;
  fileType?: string;
  sourceFile?: string;
  sourceLocation?: string;
  community?: number;
  [key: string]: unknown;
}

export interface EdgeAttributes {
  source: string;
  target: string;
  relation: string;
  label?: string;
  confidence?: string;
  confidenceScore?: number;
  sourceFile?: string;
  [key: string]: unknown;
}

export interface CommunityMap {
  [nodeId: string]: number;
}

export interface CohesionScores {
  [communityId: number]: number;
}

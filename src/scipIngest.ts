// SCIP JSON ingestion -- simplified subset

import * as crypto from "crypto";

import { sanitizeMetadata } from "./symbolResolution.js";

export function ingestScipJson(
  doc: unknown,
  sourceFile: string = "",
  language: string = "python"
): { nodes: any[]; edges: any[] } {
  const nodes: any[] = [];
  const edges: any[] = [];
  const seenNodeIds: Set<string> = new Set();
  const seenEdges: Set<string> = new Set();

  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return { nodes, edges };
  }

  const docObj = doc as Record<string, any>;
  const documents = docObj.documents;
  if (!Array.isArray(documents)) {
    return { nodes, edges };
  }

  // ---- pass 1: build symbol -> node_id indices ----
  const perDocIndex: Map<string, string> = new Map(); // "symbol_id\0doc_path" -> node_id
  const globalIndex: Map<string, string[]> = new Map(); // symbol_id -> [node_id, ...]
  const symbolRecords: any[] = [];

  for (const document of documents) {
    if (typeof document !== "object" || document === null || Array.isArray(document)) {
      continue;
    }
    const docPath = _coerceStr(document.relative_path, sourceFile);
    const docLanguage = _coerceStr(document.language, language);
    const symbols = document.symbols;
    if (!Array.isArray(symbols)) {
      continue;
    }
    for (const symbol of symbols) {
      if (typeof symbol !== "object" || symbol === null || Array.isArray(symbol)) {
        continue;
      }
      const symbolId = _coerceStr(symbol.symbol, "");
      if (!symbolId) {
        continue;
      }
      const nodeId = _makeScipNodeId(symbolId, docPath);
      const perDocKey = `${symbolId}\0${docPath}`;
      if (!perDocIndex.has(perDocKey)) {
        perDocIndex.set(perDocKey, nodeId);
      }
      const candidates = globalIndex.get(symbolId) || [];
      if (!candidates.includes(nodeId)) {
        candidates.push(nodeId);
      }
      globalIndex.set(symbolId, candidates);
      symbolRecords.push({
        node_id: nodeId,
        symbol_id: symbolId,
        doc_path: docPath,
        language: docLanguage,
        raw: symbol,
      });
    }
  }

  // ---- pass 2: emit nodes + relationship edges ----
  for (const record of symbolRecords) {
    _emitSymbolNode(record, nodes, seenNodeIds);
    _emitRelationships(
      record,
      perDocIndex,
      globalIndex,
      nodes,
      edges,
      seenNodeIds,
      seenEdges
    );
  }

  return { nodes, edges };
}

function _emitSymbolNode(
  record: any,
  nodes: any[],
  seenNodeIds: Set<string>
): void {
  const nodeId = record.node_id;
  if (seenNodeIds.has(nodeId)) {
    return;
  }
  const raw = record.raw;
  const symbolId = record.symbol_id;
  const docPath = record.doc_path;
  const kind = _coerceStr(raw.kind, "unknown");
  const displayName = _coerceStr(raw.display_name, "");
  const documentation = raw.documentation;
  let description = "";
  if (Array.isArray(documentation) && documentation.length > 0) {
    const first = documentation[0];
    if (typeof first === "string") {
      description = first;
    }
  }
  const occurrences = raw.occurrences;
  const sourceline = _firstOccurrenceLine(occurrences);
  const suffix = symbolId.includes("#") ? symbolId.split("#").pop()! : symbolId;
  const label = displayName || suffix || symbolId;
  seenNodeIds.add(nodeId);
  nodes.push({
    id: nodeId,
    label,
    file_type: _scipKindToFileType(kind),
    source_file: docPath,
    source_location: sourceline ? `L${sourceline}` : "",
    metadata: sanitizeMetadata(_buildScipMetadata(symbolId, kind, description)),
  });
}

function _emitRelationships(
  record: any,
  perDocIndex: Map<string, string>,
  globalIndex: Map<string, string[]>,
  nodes: any[],
  edges: any[],
  seenNodeIds: Set<string>,
  seenEdges: Set<string>
): void {
  const raw = record.raw;
  const sourceNodeId = record.node_id;
  const docPath = record.doc_path;
  const occurrences = raw.occurrences;
  const sourceline = _firstOccurrenceLine(occurrences);
  const relationships = raw.relationships;
  if (!Array.isArray(relationships)) {
    return;
  }
  for (const rel of relationships) {
    if (typeof rel !== "object" || rel === null || Array.isArray(rel)) {
      continue;
    }
    const targetSymbol = _coerceStr(rel.symbol, "");
    if (!targetSymbol) {
      continue;
    }
    let targetNodeId = _resolveRelationshipTarget(
      targetSymbol,
      docPath,
      perDocIndex,
      globalIndex
    );
    if (targetNodeId === null) {
      targetNodeId = _makeScipNodeId(targetSymbol, docPath);
      if (!seenNodeIds.has(targetNodeId)) {
        seenNodeIds.add(targetNodeId);
        const suffix = targetSymbol.includes("#")
          ? targetSymbol.split("#").pop()!
          : targetSymbol;
        nodes.push({
          id: targetNodeId,
          label: suffix || targetSymbol,
          file_type: "code",
          source_file: docPath,
          source_location: "",
          metadata: sanitizeMetadata(
            _buildScipMetadata(targetSymbol, "external", "")
          ),
        });
      }
    }
    const relation = _scipRelationFor(rel);
    const sourceLocation = sourceline ? `L${sourceline}` : "";
    const key = `${sourceNodeId}\0${targetNodeId}\0${relation}\0${sourceLocation}`;
    if (seenEdges.has(key)) {
      continue;
    }
    seenEdges.add(key);
    edges.push({
      source: sourceNodeId,
      target: targetNodeId,
      relation,
      confidence: "EXTRACTED",
      confidence_score: 1.0,
      source_file: docPath,
      source_location: sourceLocation,
      weight: 1.0,
      context: "scip",
      metadata: sanitizeMetadata({ scip_relationship: rel }),
    });
  }
}

function _resolveRelationshipTarget(
  targetSymbol: string,
  sourceDocPath: string,
  perDocIndex: Map<string, string>,
  globalIndex: Map<string, string[]>
): string | null {
  const sameDoc = perDocIndex.get(`${targetSymbol}\0${sourceDocPath}`);
  if (sameDoc !== undefined) {
    return sameDoc;
  }
  const candidates = globalIndex.get(targetSymbol) || [];
  if (candidates.length === 1) {
    return candidates[0];
  }
  return null;
}

export function _isTrue(value: unknown): boolean {
  return value === true;
}

function _scipRelationFor(rel: Record<string, any>): string {
  if (_isTrue(rel.is_implementation)) {
    return "scip_impl";
  }
  if (_isTrue(rel.is_type_definition)) {
    return "scip_typed";
  }
  if (_isTrue(rel.is_definition)) {
    return "scip_def";
  }
  return "scip_ref";
}

export function _firstOccurrenceLine(occurrences: unknown): number {
  if (!Array.isArray(occurrences) || occurrences.length === 0) {
    return 0;
  }
  const first = occurrences[0];
  if (typeof first !== "object" || first === null || Array.isArray(first)) {
    return 0;
  }
  const rng = first.range;
  if (!Array.isArray(rng) || rng.length < 1) {
    return 0;
  }
  const line = rng[0];
  if (typeof line === "boolean" || typeof line !== "number" || line < 0) {
    return 0;
  }
  return line;
}

function _coerceStr(value: unknown, defaultVal: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof defaultVal === "string") {
    return defaultVal;
  }
  return "";
}

export function _makeScipNodeId(symbol: string, sourceFile: string): string {
  const raw = `${sourceFile}:${symbol}`;
  const h = crypto
    .createHash("sha1")
    .update(raw)
    .digest("hex")
    .slice(0, 12);
  const parts = symbol.split("#");
  let suffix = parts.length > 0 ? parts[parts.length - 1] : symbol;
  suffix = suffix.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
  if (suffix) {
    return `scip_${suffix}_${h}`;
  }
  return `scip_${h}`;
}

function _scipKindToFileType(kind: string): string {
  return "code";
}

function _buildScipMetadata(
  symbolId: string,
  kind: string,
  description: string
): Record<string, string> {
  const meta: Record<string, string> = {
    scip_symbol: symbolId,
    scip_kind: kind,
  };
  if (description) {
    meta.scip_description = description;
  }
  return meta;
}

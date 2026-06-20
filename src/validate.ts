// validate extraction JSON against the graphify schema before graph assembly

export const VALID_FILE_TYPES = new Set([
  "code",
  "document",
  "paper",
  "image",
  "rationale",
  "concept",
]);

export const VALID_CONFIDENCES = new Set([
  "EXTRACTED",
  "INFERRED",
  "AMBIGUOUS",
]);

// snake_case for JSON compatibility; camelCase alternatives checked at runtime
export const REQUIRED_NODE_FIELDS = [
  "id",
  "label",
  "file_type",
  "source_file",
] as const;

export const REQUIRED_EDGE_FIELDS = [
  "source",
  "target",
  "relation",
  "confidence",
  "source_file",
] as const;

// camelCase alternatives for fields that differ from snake_case JSON
const NODE_CAMEL_CASE_ALIASES: Record<string, string> = {
  file_type: "fileType",
  source_file: "sourceFile",
};

const EDGE_CAMEL_CASE_ALIASES: Record<string, string> = {
  source_file: "sourceFile",
};

/**
 * Check whether a record-like object contains a given field,
 * accepting both snake_case and camelCase variants.
 */
function hasField(
  obj: Record<string, unknown>,
  snakeKey: string,
  camelAliases: Record<string, string>,
): boolean {
  if (snakeKey in obj) return true;
  const camel = camelAliases[snakeKey];
  if (camel !== undefined && camel in obj) return true;
  return false;
}

/**
 * Retrieve a field value from a record-like object,
 * falling back from snake_case to camelCase.
 */
function getField(
  obj: Record<string, unknown>,
  snakeKey: string,
  camelAliases: Record<string, string>,
): unknown {
  if (snakeKey in obj) return obj[snakeKey];
  const camel = camelAliases[snakeKey];
  if (camel !== undefined && camel in obj) return obj[camel];
  return undefined;
}

/**
 * Validate an extraction JSON object against the graphify schema.
 * Returns a list of error strings — empty list means valid.
 * Accepts both snake_case (raw JSON) and camelCase (TS interface) field names.
 */
export function validateExtraction(
  data: Record<string, unknown>,
): string[] {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return ["Extraction must be a JSON object"];
  }

  const errors: string[] = [];

  // Nodes
  if (!("nodes" in data)) {
    errors.push("Missing required key 'nodes'");
  } else if (!Array.isArray(data.nodes)) {
    errors.push("'nodes' must be a list");
  } else {
    for (let i = 0; i < data.nodes.length; i++) {
      const node = data.nodes[i] as Record<string, unknown>;
      if (typeof node !== "object" || node === null || Array.isArray(node)) {
        errors.push(`Node ${i} must be an object`);
        continue;
      }
      for (const field of REQUIRED_NODE_FIELDS) {
        if (!hasField(node, field, NODE_CAMEL_CASE_ALIASES)) {
          const id = getField(node, "id", {});
          errors.push(
            `Node ${i} (id=${JSON.stringify(id ?? "?")}) missing required field '${field}'`,
          );
        }
      }
      const fileType = getField(node, "file_type", NODE_CAMEL_CASE_ALIASES);
      if (
        fileType !== undefined &&
        typeof fileType === "string" &&
        !VALID_FILE_TYPES.has(fileType)
      ) {
        const id = getField(node, "id", {});
        errors.push(
          `Node ${i} (id=${JSON.stringify(id ?? "?")}) has invalid file_type '${fileType}' - must be one of ${[...VALID_FILE_TYPES].sort()}`,
        );
      }
    }
  }

  // Edges — accept "links" (NetworkX <= 3.1) as fallback for "edges"
  const edgeList =
    "edges" in data
      ? data.edges
      : "links" in data
        ? data.links
        : undefined;

  if (edgeList === undefined) {
    errors.push("Missing required key 'edges'");
  } else if (!Array.isArray(edgeList)) {
    errors.push("'edges' must be a list");
  } else {
    const nodes = data.nodes;
    const nodeIds = new Set<string>();
    if (Array.isArray(nodes)) {
      for (const n of nodes) {
        if (
          typeof n === "object" &&
          n !== null &&
          !Array.isArray(n) &&
          "id" in n
        ) {
          nodeIds.add((n as Record<string, unknown>)["id"] as string);
        }
      }
    }
    for (let i = 0; i < edgeList.length; i++) {
      const edge = edgeList[i] as Record<string, unknown>;
      if (typeof edge !== "object" || edge === null || Array.isArray(edge)) {
        errors.push(`Edge ${i} must be an object`);
        continue;
      }
      for (const field of REQUIRED_EDGE_FIELDS) {
        if (!hasField(edge, field, EDGE_CAMEL_CASE_ALIASES)) {
          errors.push(`Edge ${i} missing required field '${field}'`);
        }
      }
      const confidence = getField(edge, "confidence", {});
      if (
        confidence !== undefined &&
        typeof confidence === "string" &&
        !VALID_CONFIDENCES.has(confidence)
      ) {
        errors.push(
          `Edge ${i} has invalid confidence '${confidence}' - must be one of ${[...VALID_CONFIDENCES].sort()}`,
        );
      }
      const source = getField(edge, "source", {});
      if (
        source !== undefined &&
        typeof source === "string" &&
        nodeIds.size > 0 &&
        !nodeIds.has(source)
      ) {
        errors.push(
          `Edge ${i} source '${source}' does not match any node id`,
        );
      }
      const target = getField(edge, "target", {});
      if (
        target !== undefined &&
        typeof target === "string" &&
        nodeIds.size > 0 &&
        !nodeIds.has(target)
      ) {
        errors.push(
          `Edge ${i} target '${target}' does not match any node id`,
        );
      }
    }
  }

  return errors;
}

/**
 * Raise ValueError with all errors if extraction is invalid.
 */
export function assertValid(data: Record<string, unknown>): void {
  const errors = validateExtraction(data);
  if (errors.length > 0) {
    const msg = `Extraction JSON has ${errors.length} error(s):\n${errors.map((e) => `  • ${e}`).join("\n")}`;
    throw new Error(msg);
  }
}

// Cargo manifest introspection for workspace-internal crate dependencies.
import * as fs from "fs";
import * as path from "path";
import * as TOML from "smol-toml";

const _CONFIDENCE_EXTRACTED = "EXTRACTED";

interface CargoData {
  workspace?: { members?: string[] };
  package?: { name?: string; version?: string; edition?: string };
  dependencies?: Record<string, any>;
  [key: string]: any;
}

interface CrateInfo {
  name: string;
  version: string;
  path: string;
}

/** Load and parse a Cargo.toml file. */
function loadToml(filePath: string): CargoData {
  const content = fs.readFileSync(filePath, "utf-8");
  try {
    return TOML.parse(content) as CargoData;
  } catch {
    throw new Error(`Failed to parse ${filePath}: invalid TOML`);
  }
}

/** Resolve workspace member manifest paths from the root Cargo.toml. */
function memberManifestPaths(root: string, rootData: CargoData): string[] {
  const members: string[] = rootData.workspace?.members ?? [];
  const paths: string[] = [];
  for (const member of members) {
    if (member.includes("*")) {
      // Glob: scan matching directories for Cargo.toml
      const base = member.split("*")[0];
      const baseDir = path.resolve(root, base);
      if (fs.existsSync(baseDir)) {
        for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            const candidate = path.join(baseDir, entry.name, "Cargo.toml");
            if (fs.existsSync(candidate)) paths.push(candidate);
          }
        }
      }
    } else {
      const resolved = path.resolve(root, member, "Cargo.toml");
      if (fs.existsSync(resolved)) {
        paths.push(resolved);
      }
    }
  }
  return paths;
}

/** Return crate nodes and internal dependency edges from Cargo manifests. */
export function introspectCargo(root: string | path.ParsedPath): {
  nodes: CrateInfo[];
  edges: Array<{ source: string; target: string; relation: string; confidence: string }>;
} {
  const rootStr = typeof root === "string" ? root : root.dir;
  const rootPath = path.resolve(rootStr);
  const rootTomlPath = path.join(rootPath, "Cargo.toml");
  const rootData = loadToml(rootTomlPath);

  const memberPaths = memberManifestPaths(rootPath, rootData);
  // Include the root itself
  const allPaths = [rootTomlPath, ...memberPaths];

  const crateMap = new Map<string, CrateInfo>();
  const knownCrateNames = new Set<string>();

  // First pass: collect all crate names
  for (const tomlPath of allPaths) {
    const data = loadToml(tomlPath);
    const pkg = data.package;
    if (pkg?.name) {
      knownCrateNames.add(pkg.name);
      crateMap.set(pkg.name, {
        name: pkg.name,
        version: pkg.version || "0.0.0",
        path: path.relative(rootPath, path.dirname(tomlPath)) || ".",
      });
    }
  }

  // Second pass: find internal dependency edges
  const edges: Array<{ source: string; target: string; relation: string; confidence: string }> = [];
  for (const tomlPath of allPaths) {
    const data = loadToml(tomlPath);
    const pkg = data.package;
    if (!pkg?.name) continue;
    const sourceName = pkg.name;
    const deps = data.dependencies ?? {};
    for (const [depName, depSpec] of Object.entries(deps)) {
      if (!knownCrateNames.has(depName)) continue;
      // Skip path-only dev-dependencies if the spec is a string (version only)
      if (typeof depSpec === "string") continue;
      if (typeof depSpec === "object" && (depSpec as any).optional && !(depSpec as any).default_features) continue;
      edges.push({
        source: sourceName,
        target: depName,
        relation: "DEPENDS_ON",
        confidence: _CONFIDENCE_EXTRACTED,
      });
    }
  }

  return { nodes: Array.from(crateMap.values()), edges };
}

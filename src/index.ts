export const VERSION = "0.8.41";

// Types
export {
  GraphNode,
  GraphEdge,
  RawCall,
  Hyperedge,
  ExtractionResult,
} from "./types/index.js";

export { FileType } from "./types/index.js";
export type { LanguageConfig } from "./types/index.js";

export type {
  NodeAttributes,
  EdgeAttributes,
  CommunityMap,
  CohesionScores,
} from "./types/index.js";

export type {
  Pricing,
  BackendConfig,
  LLMResponse,
  CustomProvider,
} from "./types/index.js";

export type {
  GodNode,
  ConfidenceLevel,
  SurprisingConnection,
  QuestionType,
  SuggestedQuestion,
  DiffNodeEntry,
  DiffEdgeEntry,
  GraphDiff,
  ImportCycle,
} from "./types/index.js";

export type { AffectedHit } from "./types/index.js";

export type {
  SymbolDeclarationFact,
  SymbolImportFact,
  SymbolAliasFact,
  SymbolExportFact,
  StarExportFact,
  SymbolUseFact,
  ModuleImport,
  SymbolResolutionFacts,
  ImportedSymbol,
} from "./types/index.js";

// Tree-sitter
export { getParser, parseFile } from "./tree-sitter/index.js";
export type { Language as TreeSitterLanguage, Tree } from "./tree-sitter/index.js";
export { loadGrammar, getSupportedLanguages, GRAMMAR_WASM_MAP } from "./tree-sitter/index.js";
export { LANGUAGE_CONFIGS, getLanguageConfig } from "./tree-sitter/index.js";

// Graph
export { createGraph, graphFromJSON, graphToJSON } from "./graph/index.js";
export type { Graph, GraphJSON } from "./graph/index.js";

export {
  degree,
  neighbors,
  subgraphFromNodes,
  toUndirectedGraph,
  addNode,
  addEdge,
  getNodeAttributes,
  getEdgeAttributes,
  hasNode,
  hasEdge,
} from "./graph/index.js";

export { shortestPath } from "./graph/index.js";

export { louvainCommunities, leidenCommunities } from "./graph/index.js";

// Phase 2 - Core pipeline
export { cluster, cohesionScore, scoreAll, remapCommunities } from "./cluster.js";
export type { ClusterOptions } from "./cluster.js";
// export { extract, collectFiles } from "./extract/index.js";
// export { buildFromJson } from "./build/index.js";
export { godNodes, surprisingConnections, suggestQuestions, graphDiff, findImportCycles, isFileNode, isConceptNode, nodeCommunityMap } from "./analyze.js";

// Affected (impact analysis)
export { DEFAULT_AFFECTED_RELATIONS, resolveSeed, affectedNodes, formatAffected } from "./affected.js";

// Phase 3 - Report & Export
export { generate, safeCommunityName } from "./report.js";
export type { DetectionResult, GenerateOptions } from "./report.js";
export {
  toJson, pruneDanglingEdges, attachHyperedges, backupIfProtected, gitHead,
  toHtml, generateHtml, toObsidian, toCanvas, toCypher, toGraphml, toSvg,
  pushToNeo4j, pushToFalkorDB,
  COMMUNITY_COLORS, MAX_NODES_FOR_VIZ, vizNodeLimit,
  obsidianTag, safeName, capFilename, yamlStr, stripDiacritics,
  cypherEscape, cypherLabel, htmlStyles, sanitizeLabel,
} from "./export/index.js";
// export { toWiki } from "./wiki/index.js";

// Query logging
export { logQuery, nodesFromResult } from "./querylog.js";
export type { LogQueryOptions } from "./querylog.js";

// Git hooks
export {
  installHook,
  uninstallHook,
  hookStatus,
  HOOK_MARKER,
  HOOK_MARKER_END,
  CHECKOUT_MARKER,
  CHECKOUT_MARKER_END,
} from "./hooks.js";

// LLM backends & extraction
export {
  BACKENDS,
  providerBaseUrlOk,
  loadCustomProviders,
  resolveMaxTokens,
  resolveTemperature,
  defaultModelForBackend,
  getBackendApiKey,
  formatBackendEnvKeys,
  backendPkgHint,
  countTokens,
  FILE_CHAR_CAP,
  CHARS_PER_TOKEN,
  parseLlmJson,
  responseIsHollow,
  LLM_JSON_MAX_BYTES,
  callOpenAiCompat,
  callClaude,
  anthropicContent,
  callClaudeCli,
  claudeCliEnvelope,
  callAzure,
  azureClient,
  callBedrock,
  bedrockContent,
  customProvidersPath,
  extractionSystem,
  neutraliseInjectionSentinels,
  wrapUntrusted,
  readFiles,
  isVisionImage,
  partitionSemanticFiles,
  buildImageRefs,
  backendSupportsVision,
  imageNotes,
  withImageNotes,
  openaiContent,
  estimateCost,
  ollamaHostIsLinkLocalOrMetadata,
  validateOllamaBaseUrl,
  detectBackend,
  extractFilesDirect,
  estimateFileTokens,
  packChunksByTokens,
  looksLikeContextExceeded,
  extractWithAdaptiveRetry,
  extractCorpusParallel,
  callLlm,
  placeholderCommunityLabels,
  communityLabelLines,
  parseLabelResponse,
  labelCommunities,
  generateCommunityLabels,
} from "./llm/index.js";

export type { BackendDef, RawExtractionResult, ImageRef } from "./types/index.js";

// Semantic cleanup
export {
  MAX_SEMANTIC_FRAGMENT_BYTES,
  MAX_SEMANTIC_FRAGMENT_NODES,
  MAX_SEMANTIC_FRAGMENT_EDGES,
  MAX_SEMANTIC_FRAGMENT_HYPEREDGES,
  MAX_SEMANTIC_HYPEREDGE_NODES,
  MAX_SEMANTIC_ID_LENGTH,
  VALID_SEMANTIC_FILE_TYPES,
  validateSemanticFragment,
  loadValidatedSemanticFragment,
  sanitizeSemanticFragment,
  isSentenceLikeRationaleLabel,
} from "./semanticCleanup.js";

// PR dashboard
export type { PRInfo } from "./prs.js";
export {
  classifyPr,
  daysOld,
  blastRadius,
  statusColor,
  ciIcon,
  formatPrsText,
  pathMatch,
  computePrImpact,
  fetchPrs,
  fetchPrFiles,
  fetchWorktrees,
  buildCommunityLabels,
  attachGraphImpact,
  renderDashboard,
  renderWorktrees,
  renderConflicts,
  renderPrDetail,
  cmdPrs,
  green,
  red,
  yellow,
  cyan,
  bold,
  dim,
  magenta,
  pad,
  detectDefaultBranch,
  resolveTriageBackend,
  triageWithOpus,
} from "./prs.js";

// Watch / auto-rebuild
export type { LockResult, RebuildCodeDeps } from "./watch.js";
export {
  queuePending,
  drainPending,
  mergeChangedPaths,
  rebuildLock,
  checkShrink,
  canonicalGraphForCompare,
  canonicalTopologyForCompare,
  checkUpdate,
  watchPath,
  rebuildCode,
  reportRootLabel,
  isRelativeTo,
  changedPathCandidates,
  relativizeSourceFiles,
  applyResourceLimits,
  reportForCompare,
} from "./watch.js";

// ── callflowHtml ────────────────────────────────────────────────────────────
export {
  CSS,
  NormalizedNode,
  NormalizedEdge,
  Section,
  SectionArchetype,
  ResolvedPaths,
  CallflowOptions,
  escapeHtml,
  readJson,
  firstPresent,
  firstList,
  toFloat,
  endpointId,
  normalizeNode,
  normalizeEdge,
  loadGraph,
  loadLabels,
  loadSections,
  loadReport,
  safeMermaidText,
  htmlCommentText,
  stableAsciiId,
  nodeMermaidId,
  mermaidSectionId,
  safeFilePath,
  safeFilename as safeFilenameCallflow,
  inferProjectName,
  resolveGraphifyPaths,
  isZh,
  pickText,
  detectLang,
  truncateText,
  humanizeLabel,
  nodeKind,
  relationLabel,
  preferredEdges,
  edgeScore,
  mermaidInit,
  mermaidClassDefs,
  buildCommunityIndex,
  htmlAnchorId,
  normalizeCommunities,
  normalizeSections,
  labelForCommunity,
  SECTION_ARCHETYPES,
  deriveSectionsFromCommunities,
  buildSectionNodeMap,
  nodeInSection,
  classifyEdges,
  shouldIncludeEdge,
  nodeDegreeScores,
  nodeImportance,
  selectDiagramNodes,
  nodeLabel,
  groupNodesByFile,
  sectionEdgeSummary,
  generateOverviewGraph,
  generateSectionFlowchart,
  generateNav,
  nodeDisplayName,
  formatNodeRefs,
  generateCallTableRows,
  generateHeader,
  deriveFlowChain,
  generateOverviewCards,
  sectionKeywords,
  generateSectionIntro,
  generateSectionCards,
  writeCallflowHtml,
} from "./callflowHtml.js";

// ── treeHtml ────────────────────────────────────────────────────────────────
export {
  DEFAULT_MAX_CHILDREN,
  TreeNode,
  buildTree,
  emitHtml,
  writeTreeHtml,
} from "./treeHtml.js";

// ── wiki ────────────────────────────────────────────────────────────────────
export {
  safeFilename,
  crossCommunityLinks,
  communityArticle,
  godNodeArticle,
  indexMd,
  toWiki,
} from "./wiki.js";

// -- mcpIngest (MCP config ingestion) -----------------------------------------
export {
  isMcpConfigPath,
  extractMcpConfig,
  MCP_CONFIG_FILENAMES,
  detectPackageFromArgs,
  stripVersion,
  makeId,
  fileStem,
} from "./mcpIngest.js";
export type { McpExtractionResult } from "./mcpIngest.js";

// -- manifest (re-export from detect) -----------------------------------------
export {
  saveManifest,
  loadManifest,
  detectIncremental,
} from "./manifest.js";

// -- security ----------------------------------------------------------------
export {
  validateUrl,
  safeFetch,
  safeFetchText,
  validateGraphPath,
  checkGraphFileSizeCap,
  maxGraphFileBytes,
  ipIsBlocked,
} from "./security.js";

// -- ingest -------------------------------------------------------------------
export {
  yamlStr as ingestYamlStr,
  safeFilename as ingestSafeFilename,
  detectUrlType,
  ingest,
  saveQueryResult,
} from "./ingest.js";

// -- cargoIntrospect ----------------------------------------------------------
export { introspectCargo } from "./cargoIntrospect.js";

// -- pgIntrospect -------------------------------------------------------------
export { quoteIdent, introspectPostgres } from "./pgIntrospect.js";
export type { PgIntrospectResult } from "./pgIntrospect.js";

// -- googleWorkspace ----------------------------------------------------------
export {
  GOOGLE_WORKSPACE_EXTENSIONS,
  googleWorkspaceEnabled,
  readGoogleShortcut,
  convertGoogleWorkspaceFile,
  extractFileIdFromUrl,
  extractResourceKey,
} from "./googleWorkspace.js";
export type { GoogleShortcutInfo } from "./googleWorkspace.js";

// -- transcribe ---------------------------------------------------------------
export {
  VIDEO_EXTENSIONS,
  URL_PREFIXES as TRANSCRIBE_URL_PREFIXES,
  DEFAULT_MODEL as WHISPER_DEFAULT_MODEL,
  TRANSCRIPTS_DIR,
  FALLBACK_PROMPT as WHISPER_FALLBACK_PROMPT,
  isUrl as isTranscribeUrl,
  buildWhisperPrompt,
  transcribe,
  transcribeAll,
} from "./transcribe.js";

// -- globalGraph --------------------------------------------------------------
export { globalAdd, globalRemove, globalList, globalPath } from "./globalGraph.js";
export type { GlobalAddResult } from "./globalGraph.js";

// -- scipIngest ---------------------------------------------------------------
export { ingestScipJson } from "./scipIngest.js";

// -- diagnostics --------------------------------------------------------------
export {
  scanProducerSuppressionSites,
  diagnoseExtraction,
  diagnoseFile,
  formatDiagnosticJson,
  formatDiagnosticReport,
} from "./diagnostics.js";
export type {
  ProducerSuppressionResult,
  DiagnoseOptions,
  DiagnoseFileOptions,
  DiagnosticSummary,
} from "./diagnostics.js";

// -- multigraphCompat ---------------------------------------------------------
export {
  probeMultigraphCapabilities,
  requireMultigraphCapabilities,
} from "./multigraphCompat.js";
export type {
  CapabilityCheck,
  MultigraphCapabilityResult,
} from "./multigraphCompat.js";

// -- benchmark ----------------------------------------------------------------
export { queryTerms, runBenchmark, printBenchmark } from "./benchmark.js";
export type { BenchmarkResult } from "./benchmark.js";

// -- serve (MCP) --------------------------------------------------------------
export {
  buildServer,
  serve, serveHttp,
  communitiesFromGraph,
  queryGraphText, scoreNodes, pickSeeds, findNode,
  bfs, dfs, subgraphToText,
  isSearchable, computeIdf, edgeData,
  normalizeContextFilters, inferContextFilters, resolveContextFilters,
  filterGraphByContext,
  CONTEXT_HINTS, CONTEXT_FILTER_ALIASES,
} from "./serve/index.js";
export type { ServeHttpOptions } from "./serve/index.js";

// -- install ----------------------------------------------------------------
export {
  install,
  uninstallAll,
  projectInstall,
  projectUninstall,
  projectUninstallAll,
  agentsInstall,
  agentsUninstall,
  codebuddyInstall,
  codebuddyUninstall,
  printInstallUsage,
} from "./install/index.js";

export {
  claudeInstall,
  claudeUninstall,
  installClaudeHook,
  uninstallClaudeHook,
} from "./install/index.js";
export { geminiInstall, geminiUninstall } from "./install/index.js";
export { cursorInstall, cursorUninstall } from "./install/index.js";
export { vscodeInstall, vscodeUninstall } from "./install/index.js";
export { kiroInstall, kiroUninstall } from "./install/index.js";
export { antigravityInstall, antigravityUninstall } from "./install/index.js";
export { devinRulesInstall, devinRulesUninstall } from "./install/index.js";
export {
  installKiloPlugin,
  uninstallKiloPlugin,
  kiloUninstallGlobal,
  kiloInstall,
  kiloUninstall,
} from "./install/index.js";
export { installOpencodePlugin, uninstallOpencodePlugin } from "./install/index.js";
export { ampInstall, ampUninstall } from "./install/index.js";

export {
  copySkillFile,
  removeSkillFile,
  projectScopeRoot,
} from "./install/index.js";
export { platformSkillDestination, PLATFORM_CONFIG } from "./install/index.js";
export { readAlwaysOn } from "./install/index.js";
export { replaceOrAppendSection } from "./install/index.js";
export {
  skillRegistration,
  printBanner,
  refreshAllVersionStamps,
  removeGraphifySection,
} from "./install/index.js";

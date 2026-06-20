## 实施

### 阶段1：基础设施搭建

- [x] 1.1 初始化 TypeScript 项目骨架
     【目标对象】`package.json`, `tsconfig.json`, `tsup.config.ts`, `.gitignore`
     【修改目的】搭建 TypeScript 项目基础设施，与 Python 版本共存
     【修改方式】新增项目配置文件
     【相关依赖】Node.js ≥18, pnpm
     【修改内容】
        - 创建 `package.json`：包名 `graphifyy`，bin 入口 `./dist/cli.js`，type: "module"
        - 创建 `tsconfig.json`：target ES2022, module NodeNext, strict, outDir "dist"
        - 创建 `tsup.config.ts`：entry `src/index.ts` + `src/cli.ts`，format ESM+CJS，dts 生成
        - 更新 `.gitignore`：确认已有 `dist/` 条目（行8），补充 `node_modules/`；移除 Python 专属条目（`__pycache__/`, `*.pyc`, `*.egg-info/`, `.eggs/`, `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/`, `*.so`, `*.egg`, `venv/`, `.venv/`）留待阶段6执行
        - 运行 `pnpm init` 并安装核心 devDependencies：typescript, tsup, vitest, @types/node

- [x] 1.2 定义核心 TypeScript 类型系统
     【目标对象】`src/types/`
     【修改目的】将 Python dataclass/dict 转化为 TypeScript interface/type，为所有模块提供统一类型基础
     【修改方式】新建类型定义文件
     【相关依赖】无
     【修改内容】
        - 创建 `src/types/extraction.ts`：定义 `ExtractionResult`, `GraphNode`, `GraphEdge`, `RawCall`, `Hyperedge` 接口（对应 extract.py 的输出 dict 结构）
        - 创建 `src/types/language.ts`：定义 `LanguageConfig` 接口（对应 extract.py:462 的 dataclass，20+字段）和 `FileType` 枚举
        - 创建 `src/types/graph.ts`：定义 `NodeAttributes`, `EdgeAttributes`, `CommunityMap`, `CohionScores` 接口（对应 NetworkX 图属性 dict）
        - 创建 `src/types/llm.ts`：定义 `BackendConfig`, `LLMResponse`, `CustomProvider` 接口（对应 llm.py 的 BACKENDS dict）
        - 创建 `src/types/report.ts`：定义 `GodNode`, `SurprisingConnection`, `SuggestedQuestion`, `GraphDiff`, `ImportCycle` 接口
        - 创建 `src/types/affected.ts`：定义 `AffectedHit` 接口（对应 affected.py:27 的 dataclass）
        - 创建 `src/types/symbol.ts`：定义 `SymbolDeclarationFact`, `SymbolImportFact`, `SymbolAliasFact`, `SymbolExportFact`, `StarExportFact`, `SymbolUseFact`, `SymbolResolutionFacts` 接口
        - 创建 `src/types/index.ts`：统一导出所有类型

- [x] 1.3 集成 web-tree-sitter 和 grammar 加载层
     【目标对象】`src/tree-sitter/`
     【修改目的】替代 Python tree-sitter 绑定，实现多语言 AST 解析能力
     【修改方式】新建 tree-sitter 适配模块
     【相关依赖】`web-tree-sitter` npm 包
     【修改内容】
        - 安装 `web-tree-sitter`：`pnpm add web-tree-sitter`
        - 创建 `src/tree-sitter/parser.ts`：初始化 Parser 单例，封装 `initParser()` 和 `parseFile(language: string, source: string)` 方法
        - 创建 `src/tree-sitter/grammars.ts`：grammar WASM 文件路径映射和加载函数 `loadGrammar(name: string)`，覆盖 22 个核心语言
        - 创建 `src/tree-sitter/language-config.ts`：将 Python 版 `LanguageConfig` dataclass 转为 TS 常量 `LANGUAGE_CONFIGS: Record<string, LanguageConfig>`，包含各语言的 node type 映射（class_types, function_types, import_types, call_types 等）
        - 创建 `src/tree-sitter/index.ts`：统一导出

- [x] 1.4 集成 graphology 图数据结构适配层
     【目标对象】`src/graph/`
     【修改目的】替代 NetworkX，实现图数据结构和核心算法
     【修改方式】新建 graphology 适配模块
     【相关依赖】`graphology`, `graphology-types`, `graphology-communities-louvain`, `graphology-shortest-path`, `graphology-operators`
     【修改内容】
        - 安装 graphology 全家桶：`pnpm add graphology graphology-communities-louvain graphology-shortest-path graphology-operators graphology-gexf graphology-layout-forceatlas2`
        - 创建 `src/graph/factory.ts`：封装 `createGraph(directed?: boolean)` → `Graph` / `DirectedGraph`，`graphFromJSON(data)` 和 `graphToJSON(graph)` 方法（兼容 NetworkX node_link_data 格式）
        - 创建 `src/graph/operations.ts`：封装 `degree(graph, nodeId)`, `neighbors(graph, nodeId)`, `subgraph(graph, nodeIds)`, `toUndirected(graph)` 等常用操作
        - 创建 `src/graph/paths.ts`：封装 `shortestPath(graph, source, target)` → 路径数组
        - 创建 `src/graph/community.ts`：封装 `louvainCommunities(graph, resolution)` → `CommunityMap`；创建 `leidenCommunities()` 骨架（降级到 Louvain）
        - 创建 `src/graph/index.ts`：统一导出

- [x] 1.5 搭建 commander.js CLI 骨架
     【目标对象】`src/cli/`
     【修改目的】替代 Python 版 sys.argv 手动分发，建立结构化 CLI 入口
     【修改方式】新建 CLI 模块
     【相关依赖】`commander` npm 包
     【修改内容】
        - 安装 commander：`pnpm add commander`
        - 创建 `src/cli/index.ts`：主入口，`program.name('graphify').version('0.8.41')`，注册所有子命令的占位符
        - 创建 `src/cli/commands/` 目录结构，每个子命令一个文件
        - 注册核心命令占位：install, uninstall, path, explain, diagnose, clone, extract, update, cluster-only, label, query, affected, export, tree, watch, hook, benchmark, merge-driver, merge-graphs, global, add, save-result, check-update
        - 每个 command 文件仅包含 `.description()` 和 `.action()` 占位（console.log "TODO"）

- [x] 1.6 配置 vitest 测试框架
     【目标对象】`vitest.config.ts`, `package.json`, `tests/types.test.ts`
     【修改目的】建立 TypeScript 测试基础设施，替代 pytest
     【修改方式】新增 vitest 配置文件和示例测试
     【相关依赖】`vitest` npm 包
     【修改内容】
        - 安装 vitest：`pnpm add -D vitest`
        - 创建 `vitest.config.ts`：配置 test 目录、覆盖率、超时等
        - 在 `package.json` 添加 `"test": "vitest"` script
        - 创建 `tests/types.test.ts`：验证类型定义的示例测试
        - 确保 tests/fixtures/ 目录保持不变（样本文件跨语言通用）

- [x] 1.7 创建 src/index.ts 包入口（翻译 __init__.py 延迟导入映射）
     【目标对象】`src/index.ts`
     【修改目的】将 Python `graphify/__init__.py` 的延迟导入映射（`__getattr__`）翻译为 TS 模块统一导出，为库模式调用提供 API 入口
     【修改方式】新建 TS 模块入口文件
     【相关依赖】所有已迁移的核心模块
     【修改内容】
        - 创建 `src/index.ts`：统一 re-export 所有核心函数（`extract`, `collectFiles`, `buildFromJson`, `build`, `buildMerge`, `cluster`, `scoreAll`, `cohesionScore`, `godNodes`, `surprisingConnections`, `suggestQuestions`, `generate`, `toJson`, `toHtml`, `toSvg`, `toCanvas`, `toObsidian`, `toCypher`, `toGraphml`, `pushToNeo4j`, `pushToFalkorDB` 等），对应 Python `__init__.py` 中的 `__getattr__` 延迟导入映射
        - 使用 ESM named export 替代 Python 的延迟 `__getattr__` 机制
        - 此文件在阶段2-4模块迁移完成后逐步补充导出项

### 阶段2：核心管线迁移

- [x] 2.1 迁移 detect 模块（文件检测与分类）
     【目标对象】`src/detect.ts`
     【修改目的】将 Python detect.py 的文件分类、PDF/Office 文本提取功能迁移为 TypeScript
     【修改方式】新建 TS 模块，1:1 翻译 Python 逻辑
     【相关依赖】`pdf-parse`(PDF), `mammoth`(docx), `exceljs`(xlsx), `isbinaryfile`(二进制检测)
     【修改内容】
        - 翻译 `FileType` 枚举和扩展名集合常量（CODE_EXTENSIONS, DOC_EXTENSIONS 等）
        - 翻译 `classify_file()` → `classifyFile(path: string): FileType | null`
        - 翻译 `extract_pdf_text()` → `extractPdfText(path: string): string`（使用 pdf-parse 替代 pypdf）
        - 翻译 `extract_office_text()` → `extractOfficeText(path: string): string`（使用 mammoth/exceljs 替代 python-docx/openpyxl）
        - 翻译 gitignore 检测逻辑
        - 翻译增量检测逻辑
        - 翻译 `tests/test_detect.py` → `tests/detect.test.ts`

- [x] 2.2 迁移 validate 模块
     【目标对象】`src/validate.ts`
     【修改目的】将 Python validate.py 的提取结果验证功能迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】`src/types/extraction.ts`
     【修改内容】
        - 翻译 `validate_extraction()` → `validateExtraction(data: ExtractionResult): void`
        - 翻译节点/边结构校验逻辑
        - 翻译 `tests/test_validate.py` → `tests/validate.test.ts`

- [x] 2.3 迁移 cache 模块（AST/语义缓存）
     【目标对象】`src/cache.ts`
     【修改目的】将 Python cache.py 的文件级缓存机制迁移为 TypeScript
     【修改方式】新建 TS 模块，使用 Node.js fs 实现文件缓存
     【相关依赖】`src/types/extraction.ts`
     【修改内容】
        - 翻译 `load_cached()` → `loadCached(path: string, cacheRoot: string): ExtractionResult | null`
        - 翻译 `save_cached()` → `saveCached(path: string, data: ExtractionResult, cacheRoot: string): void`
        - 翻译缓存失效逻辑（基于文件 hash）
        - 翻译 `tests/test_cache.py` → `tests/cache.test.ts`

- [x] 2.4 迁移 extract 模块核心框架（不含语言提取器细节）
     【目标对象】`src/extract/`
     【修改目的】将 Python extract.py 的核心提取框架迁移为 TypeScript，语言提取器按语言拆分为独立文件
     【修改方式】新建多文件模块，拆分 Python 单体文件
     【相关依赖】`src/tree-sitter/`, `src/cache.ts`, `src/detect.ts`, `src/types/`
     【修改内容】
        - 创建 `src/extract/index.ts`：主入口函数 `extract(paths, options)` 和 `collectFiles(target, options)`
        - 创建 `src/extract/framework.ts`：提取框架逻辑——文件收集、缓存检查、并行调度（使用 Node.js worker_threads.Worker 替代 Python ThreadPoolExecutor，并发数默认 `os.cpus().length`，通过 MessageChannel 通信）、结果合并 `_mergeInto()`
        - 创建 `src/extract/adaptive-retry.ts`：自适应重试 `_extractWithAdaptiveRetry()`（bisect chunk on truncation）
        - 创建 `src/extract/semantic-extract.ts`：LLM 语义提取路径 `_partition_semantic_files()`, `_read_files()`, `_build_image_refs()`
        - 创建 `src/extract/ast-extract.ts`：AST 提取通用框架，遍历 tree-sitter AST 节点
        - 翻译 `tests/test_extract.py` 的框架测试 → `tests/extract.test.ts`

- [x] 2.5 迁移 extract 语言提取器（按语言拆分）
     【目标对象】`src/extract/languages/`
     【修改目的】将 Python extract.py 中的 30+ 语言提取函数拆分为独立 TS 文件
     【修改方式】每种语言一个文件，翻译提取逻辑
     【相关依赖】`src/tree-sitter/language-config.ts`, `src/extract/ast-extract.ts`
     【修改内容】
        - 创建 `src/extract/languages/python.ts`：Python 函数/类/导入提取
        - 创建 `src/extract/languages/typescript.ts`：TS/TSX 提取（language_typescript + language_tsx）
        - 创建 `src/extract/languages/javascript.ts`：JS 提取
        - 创建 `src/extract/languages/go.ts`：Go 提取
        - 创建 `src/extract/languages/rust.ts`：Rust 提取
        - 创建 `src/extract/languages/java.ts`：Java 提取
        - 创建 `src/extract/languages/c.ts` + `cpp.ts`：C/C++ 提取（含 cpp 预处理逻辑）
        - 创建 `src/extract/languages/csharp.ts`：C# 提取
        - 创建 `src/extract/languages/ruby.ts`：Ruby 提取
        - 创建 `src/extract/languages/kotlin.ts`：Kotlin 提取
        - 创建 `src/extract/languages/scala.ts`：Scala 提取
        - 创建 `src/extract/languages/php.ts`：PHP 提取
        - 创建 `src/extract/languages/swift.ts`：Swift 提取
        - 创建 `src/extract/languages/lua.ts` + `luau.ts`：Lua/Luau 提取
        - 创建 `src/extract/languages/bash.ts`：Bash 提取
        - 创建 `src/extract/languages/elixir.ts`：Elixir 提取
        - 创建 `src/extract/languages/julia.ts`：Julia 提取
        - 创建 `src/extract/languages/groovy.ts`：Groovy 提取（WASM 可用性待验证，降级到文本匹配后备）
        - 创建 `src/extract/languages/zig.ts`：Zig 提取
        - 创建 `src/extract/languages/powershell.ts`：PowerShell 提取
        - 创建 `src/extract/languages/objc.ts`：Objective-C 提取
        - 创建 `src/extract/languages/dart.ts`：Dart 提取
        - 创建 `src/extract/languages/verilog.ts` + `fortran.ts`：Verilog/Fortran 提取
        - 创建 `src/extract/languages/json.ts`：JSON schema 提取
        - 创建 `src/extract/languages/sql.ts`：SQL 提取
        - 创建 `src/extract/languages/hcl.ts`：Terraform HCL 提取
        - 创建 `src/extract/languages/dm.ts`：DreamMaker 提取
        - 创建 `src/extract/languages/pascal.ts`：Pascal/Delphi 提取
        - 创建 `src/extract/languages/registry.ts`：语言注册表，汇总所有语言提取器
        - 翻译各语言对应的测试用例

- [x] 2.6 迁移 symbol_resolution 模块
     【目标对象】`src/symbolResolution.ts`
     【修改目的】将跨文件符号解析功能迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】`src/types/symbol.ts`, `src/extract/`
     【修改内容】
        - 翻译 `_SymbolDeclarationFact` 等数据类为 TS interface（已在 types 中定义）
        - 翻译 `resolve_symbols()` → `resolveSymbols(facts: SymbolResolutionFacts): Map<string, string>`
        - 翻译 Python/JS/TS 特定的导入解析逻辑
        - 翻译 `tests/test_symbol_resolution.py` → `tests/symbolResolution.test.ts`

- [x] 2.7 迁移 file_slice 和 _minhash 模块
     【目标对象】`src/fileSlice.ts`, `src/minhash.ts`
     【修改目的】将文件切片和 MinHash 算法迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】无外部依赖
     【修改内容】
        - 翻译 `FileSlice` dataclass → interface
        - 翻译 `file_slice.py` 的切片逻辑 → `fileSlice()` 函数
        - 翻译 `_minhash.py` 的纯 Python MinHash 实现 → 纯 TS 实现（哈希函数用 Node.js crypto）
        - 翻译 `tests/test_file_slice.py` + `tests/test_minhash.py`

- [x] 2.8 迁移 build 模块（构图引擎）
     【目标对象】`src/build.ts`
     【修改目的】将 Python build.py 的图构建逻辑迁移为 TypeScript，使用 graphology
     【修改方式】新建 TS 模块
     【相关依赖】`src/graph/`, `src/types/`, `src/validate.ts`, `src/dedup.ts`
     【修改内容】
        - 翻译 `build_from_json()` → `buildFromJson(extraction: ExtractionResult, options): Graph`
        - 翻译 `build()` → `build(extractions: ExtractionResult[], options): Graph`
        - 翻译 `build_merge()` → `buildMerge(extractions, existingPath, options): Graph`
        - 翻译 `dedupe_nodes()`, `dedupe_edges()`, `deduplicate_by_label()` 等辅助函数
        - 翻译 `prefix_graph_for_global()`, `prune_repo_from_graph()`
        - 翻译 `tests/test_build.py` → `tests/build.test.ts`

- [x] 2.9 迁移 dedup 模块（MinHash 去重 + LLM tiebreak）
     【目标对象】`src/dedup.ts`
     【修改目的】将 Python dedup.py 的实体去重功能迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】`src/minhash.ts`, `src/llm/`
     【修改内容】
        - 翻译 `deduplicate_entities()` → `deduplicateEntities(nodes: GraphNode[], edges: GraphEdge[]): DedupResult`
        - 翻译 MinHash 相似度计算逻辑
        - 翻译 LLM tiebreak 调用
        - 翻译 `tests/test_dedup.py` → `tests/dedup.test.ts`

- [x] 2.10 迁移 cluster 模块（社区检测）
     【目标对象】`src/cluster.ts`
     【修改目的】将 Python cluster.py 的 Leiden/Louvain 社区检测迁移为 TypeScript
     【修改方式】新建 TS 模块，使用 graphology-communities-louvain
     【相关依赖】`src/graph/community.ts`, `src/graph/`
     【修改内容】
        - 翻译 `cluster()` → `cluster(graph: Graph, resolution): CommunityMap`
        - 翻译 `cohesion_score()` → `cohesionScore(graph: Graph, communityNodes: string[]): number`
        - 翻译 `score_all()` → `scoreAll(graph: Graph, communities: CommunityMap): Record<number, number>`
        - 翻译 `remap_communities_to_previous()` → `remapCommunities()`
        - Leiden 降级：优先使用 Louvain（graphology），标注 Leiden 为 TODO
        - 翻译 `tests/test_cluster.py` → `tests/cluster.test.ts`

- [x] 2.11 迁移 analyze 模块（图分析）
     【目标对象】`src/analyze.ts`
     【修改目的】将 Python analyze.py 的图分析功能迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】`src/graph/`
     【修改内容】
        - 翻译 `god_nodes()` → `godNodes(graph: Graph, topN: number): GodNode[]`
        - 翻译 `surprising_connections()` → `surprisingConnections(graph: Graph, communities, options): SurprisingConnection[]`
        - 翻译 `suggest_questions()` → `suggestQuestions(graph: Graph, communities): SuggestedQuestion[]`
        - 翻译 `graph_diff()` → `graphDiff(oldGraph: Graph, newGraph: Graph): GraphDiff`
        - 翻译 `find_import_cycles()` → `findImportCycles(graph: Graph, maxCycleLength): ImportCycle[]`
        - 翻译 `tests/test_analyze.py` → `tests/analyze.test.ts`

- [x] 2.12 迁移 report 模块（Markdown 报告生成）
     【目标对象】`src/report.ts`
     【修改目的】将 Python report.py 的 Markdown 报告生成迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】`src/analyze.ts`, `src/graph/`
     【修改内容】
        - 翻译 `generate()` → `generate(graph: Graph, communities, cohesionScores, communityLabels, godNodes, surprises, options): string`
        - 翻译各报告段落模板（God Nodes、社区摘要、意外连接等）
        - 翻译 `tests/test_report.py` → `tests/report.test.ts`

- [x] 2.13 迁移 export 模块（多格式导出）
     【目标对象】`src/export/`
     【修改目的】将 Python export.py 的多格式导出功能迁移为 TypeScript
     【修改方式】新建多文件模块
     【相关依赖】`src/graph/`, `src/cluster.ts`
     【修改内容】
        - 创建 `src/export/index.ts`：统一导出
        - 创建 `src/export/json.ts`：`toJson()` — graphology → node_link JSON
        - 创建 `src/export/html.ts`：`toHtml()` — D3.js 可视化 HTML
        - 创建 `src/export/obsidian.ts`：`toObsidian()` — Obsidian Markdown 生成
        - 创建 `src/export/canvas.ts`：`toCanvas()` — Obsidian Canvas JSON
        - 创建 `src/export/cypher.ts`：`toCypher()` — Cypher 语句生成
        - 创建 `src/export/graphml.ts`：`toGraphml()` — 使用 graphology-gexf
        - 创建 `src/export/svg.ts`：`toSvg()` — SVG 生成（可选，依赖布局库）
        - 创建 `src/export/neo4j.ts`：`pushToNeo4j()` — Neo4j 驱动（neo4j-driver npm）
        - 创建 `src/export/falkordb.ts`：`pushToFalkorDB()` — FalkorDB 驱动
        - 翻译 `tests/test_export.py` → `tests/export.test.ts`

### 阶段3：辅助模块迁移

- [x] 3.1 迁移 llm 模块（LLM 后端集成）
     【目标对象】`src/llm/`
     【修改目的】将 Python llm.py 的多 LLM 后端调用迁移为 TypeScript
     【修改方式】新建多文件模块
     【相关依赖】`openai`, `@anthropic-ai/sdk`, `@aws-sdk/client-bedrock-runtime`, `js-tiktoken`
     【修改内容】
        - 创建 `src/llm/index.ts`：主入口 `callLlm()`, `extractFilesDirect()`
        - 创建 `src/llm/backends.ts`：`BACKENDS` 配置常量（OpenAI/Anthropic/Kimi/Ollama/Gemini/DeepSeek/Azure/Bedrock/Claude-CLI）
        - 创建 `src/llm/openai-compat.ts`：`callOpenAiCompat()` — 统一 OpenAI 兼容端点（OpenAI/Kimi/Ollama/DeepSeek/Gemini）
        - 创建 `src/llm/anthropic.ts`：`callClaude()` — 使用 @anthropic-ai/sdk
        - 创建 `src/llm/claude-cli.ts`：`callClaudeCli()` — child_process.execFile("claude", ["-p", ...])
        - 创建 `src/llm/azure.ts`：`callAzure()` — 使用 openai SDK Azure subclass
        - 创建 `src/llm/bedrock.ts`：`callBedrock()` — 使用 @aws-sdk/client-bedrock-runtime
        - 创建 `src/llm/custom-providers.ts`：`loadCustomProviders()` — 从 ~/.graphify/providers.json 加载
        - 创建 `src/llm/parser.ts`：`parseLlmJson()` — LLM 响应 JSON 解析
        - 创建 `src/llm/tokens.ts`：Token 计数（js-tiktoken）
        - 翻译 `tests/test_llm_backends.py` → `tests/llm.test.ts`

- [x] 3.2 迁移 semantic_cleanup 模块
     【目标对象】`src/semanticCleanup.ts`
     【修改目的】将语义清理功能迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】`src/llm/`
     【修改内容】
        - 翻译 `semantic_cleanup()` → `semanticCleanup(extraction: ExtractionResult, options): ExtractionResult`
        - 翻译 `tests/test_semantic_cleanup.py` → `tests/semanticCleanup.test.ts`

- [x] 3.3 迁移 hooks 模块（Git 钩子管理）
     【目标对象】`src/hooks.ts`
     【修改目的】将 Git 钩子安装/卸载/触发逻辑迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】Node.js fs/path, child_process
     【修改内容】
        - 翻译 `install_hook()` → `installHook(repoPath: string): void`
        - 翻译 `uninstall_hook()` → `uninstallHook(repoPath: string): void`
        - 翻译 `hook_status()` → `hookStatus(repoPath: string): HookStatus`
        - 翻译后台执行逻辑（child_process.Popen → child_process.spawn detached）
        - 翻译 `tests/test_hooks.py` → `tests/hooks.test.ts`

- [x] 3.4 迁移 watch 模块（文件监视 + 增量重建）
     【目标对象】`src/watch.ts`
     【修改目的】将文件监视功能迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】Node.js fs.watch, chokidar
     【修改内容】
        - 安装 chokidar：`pnpm add chokidar`
        - 翻译 `watch()` → `watchPath(target: string, options): void`
        - 翻译增量重建逻辑（检测变更文件 → 重新提取 → 合并图）
        - 翻译 `tests/test_watch.py` → `tests/watch.test.ts`

- [x] 3.5 迁移 prs 模块（PR 影响分析）
     【目标对象】`src/prs.ts`
     【修改目的】将 PR 分析和 GitHub CLI 集成迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】child_process（gh, git 命令）, `src/graph/`
     【修改内容】
        - 翻译 `analyze_pr()` → `analyzePr(options): PRAnalysis`
        - 翻译 `list_prs()` → `listPrs(): PRInfo[]`
        - 翻译 `gh`/`git` 子进程调用 → child_process.execFile
        - 翻译 `tests/test_prs.py` → `tests/prs.test.ts`

- [x] 3.6 迁移 affected 模块（影响分析）
     【目标对象】`src/affected.ts`
     【修改目的】将影响范围分析迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】`src/graph/`
     【修改内容】
        - 翻译 `affected()` → `affected(graph: Graph, target: string, options): AffectedHit[]`
        - 翻译 BFS 遍历逻辑
        - 翻译 `tests/test_affected_cli.py` → `tests/affected.test.ts`

- [x] 3.7 迁移 querylog 模块（查询日志）
     【目标对象】`src/querylog.ts`
     【修改目的】将查询结果保存/检索功能迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】Node.js fs/path
     【修改内容】
        - 翻译 `save_result()` → `saveResult(options): void`
        - 翻译结果文件读写逻辑
        - 翻译 `tests/test_querylog.py` → `tests/querylog.test.ts`

- [x] 3.8 迁移 callflow_html 模块
     【目标对象】`src/callflowHtml.ts`
     【修改目的】将 Mermaid 调用流 HTML 生成迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】`src/graph/`
     【修改内容】
        - 翻译 `generate_callflow_html()` → `generateCallflowHtml(graph: Graph, options): string`
        - 翻译 Mermaid 语法生成逻辑
        - 翻译 HTML 模板
        - 翻译 `tests/test_callflow_html.py` → `tests/callflowHtml.test.ts`

- [x] 3.9 迁移 tree_html 模块
     【目标对象】`src/treeHtml.ts`
     【修改目的】将目录树 HTML 生成迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】`src/graph/`
     【修改内容】
        - 翻译 `generate_tree_html()` → `generateTreeHtml(graph: Graph, options): string`
        - 翻译 `tests/test_tree_html.py`（如有）

- [x] 3.10 迁移 wiki 模块
     【目标对象】`src/wiki.ts`
     【修改目的】将 Wiki 导出功能迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】`src/graph/`, `src/cluster.ts`
     【修改内容】
        - 翻译 `to_wiki()` → `toWiki(graph: Graph, communities, options): void`
        - 翻译 Wiki Markdown 文件生成逻辑
        - 翻译 `tests/test_wiki.py` → `tests/wiki.test.ts`

### 阶段4：服务与集成迁移

- [x] 4.1 迁移 serve 模块（MCP 服务 + 图查询引擎）
     【目标对象】`src/serve/`
     【修改目的】将 MCP stdio/HTTP 服务和图查询引擎迁移为 TypeScript，使用官方 MCP SDK
     【修改方式】新建多文件模块
     【相关依赖】`@modelcontextprotocol/sdk`, `src/graph/`, `src/analyze.ts`
     【修改内容】
        - 安装 `@modelcontextprotocol/sdk`：`pnpm add @modelcontextprotocol/sdk`
        - 创建 `src/serve/index.ts`：MCP 服务入口
        - 创建 `src/serve/server.ts`：MCP Server 定义，注册 tools/resources（path_query, explain, search, affected 等）
        - 创建 `src/serve/query-engine.ts`：图查询引擎（DFS/BFS 搜索、路径查询、解释生成）
        - 创建 `src/serve/transport.ts`：stdio 和 SSE 传输层配置
        - 翻译 `tests/test_serve.py` → `tests/serve.test.ts`
        - 翻译 `tests/test_serve_http.py` → `tests/serveHttp.test.ts`

- [x] 4.2 迁移 mcp_ingest 模块
     【目标对象】`src/mcpIngest.ts`
     【修改目的】将 MCP 配置文件提取功能迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】Node.js fs/path
     【修改内容】
        - 翻译 `extract_mcp_config()` → `extractMcpConfig(path: string): MCPConfig | null`
        - 翻译 `is_mcp_config_path()` → `isMcpConfigPath(path: string): boolean`
        - 翻译 `tests/test_mcp_ingest.py` → `tests/mcpIngest.test.ts`

- [x] 4.3 迁移 ingest 模块（外部仓库摄入）
     【目标对象】`src/ingest.ts`
     【修改目的】将外部仓库/包摄入功能迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】child_process（git clone）, `src/extract/`, `src/build.ts`
     【修改内容】
        - 翻译 `add()` → `add(url: string, options): void`
        - 翻译 git clone + 提取 + 构建逻辑
        - 翻译 `tests/test_ingest.py` → `tests/ingest.test.ts`

- [x] 4.4 迁移 global_graph 模块（全局图管理）
     【目标对象】`src/globalGraph.ts`
     【修改目的】将全局图合并/管理功能迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】`src/graph/`, `src/build.ts`
     【修改内容】
        - 翻译 `global add/remove/list/path` 子命令逻辑
        - 翻译图合并逻辑
        - 翻译 `tests/test_global_graph.py` → `tests/globalGraph.test.ts`

- [x] 4.5 迁移 manifest 模块（增量检测）
     【目标对象】`src/manifest.ts`
     【修改目的】将增量构建检测功能迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】Node.js fs/path
     【修改内容】
        - 翻译 `check_update()` → `checkUpdate(path: string): UpdateStatus`
        - 翻译 manifest 文件读写逻辑
        - 翻译 `tests/test_incremental.py` → `tests/manifest.test.ts`

- [x] 4.6 迁移 cargo_introspect 和 pg_introspect 模块
     【目标对象】`src/cargoIntrospect.ts`, `src/pgIntrospect.ts`
     【修改目的】将 Cargo 项目和 PostgreSQL 数据库内省功能迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】child_process（cargo metadata, psql/pg_dump）, `pg` npm 包
     【修改内容】
        - 翻译 `cargo_introspect.py` → `cargoIntrospect.ts`：cargo metadata 解析
        - 翻译 `pg_introspect.py` → `pgIntrospect.ts`：PostgreSQL schema 内省
        - 翻译 `tests/test_cargo_introspect.py` → `tests/cargoIntrospect.test.ts`
        - 翻译 `tests/test_pg_introspect.py` → `tests/pgIntrospect.test.ts`

- [x] 4.7 迁移 scip_ingest 模块
     【目标对象】`src/scipIngest.ts`
     【修改目的】将 SCIP 索引摄入功能迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】Node.js fs/path, `protobufjs` npm 包
     【修改内容】
        - 安装 protobufjs：`pnpm add protobufjs`
        - 翻译 SCIP 索引文件解析逻辑：使用 protobufjs 加载 SCIP .proto schema 定义，解析 SCIP 索引文件中的 Symbol/Role/Relationship 字段，提取符号信息转为内部 ExtractionResult 格式
        - 翻译 `tests/test_scip_ingest.py` → `tests/scipIngest.test.ts`

- [x] 4.8 迁移 google_workspace 模块
     【目标对象】`src/googleWorkspace.ts`
     【修改目的】将 Google Workspace 文件转换功能迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】child_process（gws CLI）
     【修改内容】
        - 翻译扩展名检测和文件转换逻辑
        - 翻译 `gws drive files export` 子进程调用
        - 翻译 `tests/test_google_workspace.py` → `tests/googleWorkspace.test.ts`

- [x] 4.9 迁移 security 模块
     【目标对象】`src/security.ts`
     【修改目的】将安全扫描功能迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】`src/graph/`
     【修改内容】
        - 翻译安全模式检测逻辑
        - 翻译 `tests/test_security.py` → `tests/security.test.ts`

- [x] 4.10 迁移 diagnostics 和 multigraph_compat 模块
     【目标对象】`src/diagnostics.ts`, `src/multigraphCompat.ts`
     【修改目的】将诊断工具和多图兼容性检查迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】`src/graph/`
     【修改内容】
        - 翻译 `diagnose_multigraph()` → `diagnoseMultigraph(graph: Graph): DiagnosticResult`
        - 翻译 `CapabilityCheck` / `MultigraphCapabilityResult` → TS interface
        - 翻译 `tests/test_multigraph_compat.py` → `tests/multigraphCompat.test.ts`
        - 翻译 `tests/test_multigraph_diagnostics.py` → `tests/diagnostics.test.ts`

- [x] 4.11 迁移 benchmark 模块
     【目标对象】`src/benchmark.ts`
     【修改目的】将基准测试功能迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】`src/extract/`, `src/build.ts`
     【修改内容】
        - 翻译基准测试逻辑和计时统计
        - 翻译 `tests/test_benchmark.py` → `tests/benchmark.test.ts`

- [x] 4.12 迁移 transcribe 模块（视频转录）
     【目标对象】`src/transcribe.ts`
     【修改目的】将视频/音频转录功能迁移为 TypeScript
     【修改方式】新建 TS 模块
     【相关依赖】child_process（whisper/yt-dlp）
     【修改内容】
        - 翻译转录逻辑
        - 翻译 `tests/test_transcribe.py` → `tests/transcribe.test.ts`

### 阶段5：CLI 与安装系统迁移

- [x] 5.1 实现 CLI 全部子命令（填充占位符）
     【目标对象】`src/cli/commands/`
     【修改目的】将 `graphify/__main__.py` 的 40+ 子命令实现迁移到 commander.js 命令处理器
     【修改方式】修改占位命令文件，为每个命令实现 action 处理函数，调用对应 TS 模块
     【相关依赖】所有已迁移的模块
     【修改内容】
        - 实现 `extract` 命令：调用 src/extract/ + src/llm/ + src/build/ + src/cluster/
        - 实现 `update` 命令：调用 detect + extract + build + cluster 全管线
        - 实现 `cluster-only` 命令：调用 src/cluster.ts + src/llm/ (标签)
        - 实现 `label` 命令：调用 src/llm/
        - 实现 `query` 命令：调用 src/serve/ 查询引擎
        - 实现 `path` 命令：调用 src/graph/paths.ts
        - 实现 `explain` 命令：调用 src/serve/ 查询引擎
        - 实现 `affected` 命令：调用 src/affected.ts
        - 实现 `diagnose` 命令：调用 src/diagnostics.ts
        - 实现 `clone` 命令：child_process.execFile("git", ["clone", ...])
        - 实现 `watch` 命令：调用 src/watch.ts
        - 实现 `export` 子命令：调用 src/export/
        - 实现 `tree` 命令：调用 src/treeHtml.ts
        - 实现 `hook install/uninstall/status` 命令：调用 src/hooks.ts
        - 实现 `merge-driver`/`merge-graphs` 命令：调用 src/build.ts, src/globalGraph.ts
        - 实现 `global add/remove/list/path` 命令：调用 src/globalGraph.ts
        - 实现 `add` 命令：调用 src/ingest.ts
        - 实现 `save-result` 命令：调用 src/querylog.ts
        - 实现 `check-update` 命令：调用 src/manifest.ts
        - 实现 `benchmark` 命令：调用 src/benchmark.ts
        - 注：`install`/`uninstall` 命令由任务 5.2 实现

- [x] 5.2 实现 skill 安装/卸载系统
     【目标对象】`src/install/`
     【修改目的】将 `graphify/__main__.py` 中 20+ 平台的 skill 安装/卸载逻辑迁移为 TypeScript
     【修改方式】新建安装系统模块
     【相关依赖】Node.js fs/path
     【修改内容】
        - 创建 `src/install/index.ts`：`install(platform, options)` 和 `uninstall(options)`
        - 创建 `src/install/skill-files.ts`：skill Markdown 文件嵌入（将 always_on/ 和 skills/ 下的 .md 文件打包为 TS 字符串常量或复制到 dist）
        - 创建 `src/install/platforms/` 目录：每个平台一个安装器
          - `claude.ts`, `gemini.ts`, `cursor.ts`, `vscode.ts`, `copilot.ts`, `aider.ts`, `codex.ts`, `devin.ts`, `kiro.ts`, `droid.ts`, `amp.ts`, `claw.ts`, `kilo.ts`, `opencode.ts`, `pi.ts`, `trae.ts`, `windows.ts`
        - 翻译各平台的配置文件路径和写入逻辑
        - 翻译 `tests/test_install.py` + `tests/test_install_references.py` + `tests/test_install_roundtrip.py` + `tests/test_install_strings.py` + `tests/test_install_upgrade.py`

- [x] 5.3 迁移 skillgen 工具
     【目标对象】`tools/skillgen/`
     【修改目的】将 skill 生成工具从 Python 迁移为 TypeScript
     【修改方式】重写为 TS 脚本
     【相关依赖】Node.js fs/path
     【修改内容】
        - 创建 `tools/skillgen/index.ts`：生成 expected/ 目录下的 skill 文件
        - 翻译 skillgen 生成逻辑
        - 翻译 `tests/test_skillgen.py` → `tests/skillgen.test.ts`

### 阶段6：收尾与清理

- [ ] 6.1 迁移剩余测试用例
     【目标对象】`tests/`
     【修改目的】将所有 pytest 测试迁移为 vitest 测试
     【修改方式】逐个翻译测试文件
     【相关依赖】vitest, 所有已迁移模块
     【修改内容】
        - 翻译 `conftest.py` 配置（极简，仅需 vitest setup 文件）
        - 翻译以下阶段2-4中未单独覆盖的测试文件：
          - `test_astro_extraction.py` → `tests/astroExtraction.test.ts`（AST 提取集成测试）
          - `test_charmap_encoding.py` → `tests/charmapEncoding.test.ts`（字符编码测试）
          - `test_chunking.py` → `tests/chunking.test.ts`（文件分块测试）
          - `test_cpp_preprocess.py` → `tests/cppPreprocess.test.ts`（C++ 预处理测试）
          - `test_devin.py` → `tests/devin.test.ts`（Devin skill 集成测试）
          - `test_dotnet.py` → `tests/dotnet.test.ts`（.NET 提取测试）
          - `test_dart.py` → `tests/dart.test.ts`（Dart 提取测试）
          - `test_hypergraph.py` → `tests/hypergraph.test.ts`（超图测试）
          - `test_image_vision.py` → `tests/imageVision.test.ts`（图像视觉测试）
          - `test_import_extension_resolution.py` → `tests/importExtensionResolution.test.ts`（导入扩展解析测试）
          - `test_java_type_resolution.py` → `tests/javaTypeResolution.test.ts`（Java 类型解析测试）
          - `test_js_import_resolution.py` → `tests/jsImportResolution.test.ts`（JS 导入解析测试）
          - `test_python_import_resolution.py` → `tests/pythonImportResolution.test.ts`（Python 导入解析测试）
          - `test_swift_import_resolution.py` → `tests/swiftImportResolution.test.ts`（Swift 导入解析测试）
          - `test_swift_cross_file_calls.py` → `tests/swiftCrossFileCalls.test.ts`（Swift 跨文件调用测试）
          - `test_ts_inheritance.py` → `tests/tsInheritance.test.ts`（TS 继承测试）
          - `test_labeling.py` → `tests/labeling.test.ts`（LLM 标签测试）
          - `test_languages.py` → `tests/languages.test.ts`（多语言提取集成测试）
          - `test_multilang.py` → `tests/multilang.test.ts`（多语言混合项目测试）
          - `test_pipeline.py` → `tests/pipeline.test.ts`（全管线集成测试）
          - `test_confidence.py` → `tests/confidence.test.ts`（置信度评分测试）
          - `test_rationale.py` → `tests/rationale.test.ts`（rationale 生成测试）
          - `test_semantic_similarity.py` → `tests/semanticSimilarity.test.ts`（语义相似度测试）
          - `test_obsidian_dangling_member.py` → `tests/obsidianDanglingMember.test.ts`（Obsidian 悬空成员测试）
          - `test_obsidian_filename_cap.py` → `tests/obsidianFilenameCap.test.ts`（Obsidian 文件名上限测试）
          - `test_office_limits.py` → `tests/officeLimits.test.ts`（Office 文件限制测试）
          - `test_terraform.py` → `tests/terraform.test.ts`（Terraform HCL 测试）
          - `test_pascal.py` → `tests/pascal.test.ts`（Pascal/Delphi 测试）
          - `test_file_node_id_spec.py` → `tests/fileNodeIdSpec.test.ts`（文件节点 ID 规范测试）
          - `test_falkordb_integration.py` → `tests/falkordbIntegration.test.ts`（FalkorDB 集成测试）
          - `test_provider_registry.py` → `tests/providerRegistry.test.ts`（LLM 提供者注册测试）
          - `test_wheel_packaging.py` → `tests/wheelPackaging.test.ts`（包发布测试）
          - `test_antigravity_install.py` → `tests/antigravityInstall.test.ts`（antigravity 安装测试）
          - `test_backend_extras.py` → `tests/backendExtras.test.ts`（LLM 后端附加测试）
          - `test_anthropic_custom_endpoint.py` → `tests/anthropicCustomEndpoint.test.ts`（Anthropic 自定义端点测试）
          - `test_openai_custom_endpoint.py` → `tests/openaiCustomEndpoint.test.ts`（OpenAI 自定义端点测试）
          - `test_ollama.py` → `tests/ollama.test.ts`（Ollama 后端测试）
          - `test_claude_cli_backend.py` → `tests/claudeCliBackend.test.ts`（Claude CLI 后端测试）
          - `test_claude_md.py` → `tests/claudeMd.test.ts`（CLAUDE.md 安装测试）
          - `test_llm_parser.py` → `tests/llmParser.test.ts`（LLM 响应解析测试）
          - `test_codebuddy.py` → `tests/codebuddy.test.ts`（Codebuddy skill 测试）
          - `test_cli_export.py` → `tests/cliExport.test.ts`（CLI export 子命令测试）
          - `test_extract_cli.py` → `tests/extractCli.test.ts`（CLI extract 子命令测试）
          - `test_explain_cli.py` → `tests/explainCli.test.ts`（CLI explain 子命令测试）
          - `test_path_cli.py` → `tests/pathCli.test.ts`（CLI path 子命令测试）
          - `test_query_cli.py` → `tests/queryCli.test.ts`（CLI query 子命令测试）
          - `test_read_hook.py` → `tests/readHook.test.ts`（read hook 测试）
        - 确保测试 fixtures（sample 文件）保持不变，跨语言通用

- [ ] 6.2 更新项目配置文件
     【目标对象】`Dockerfile`, `.github/workflows/ci.yml`, `.github/workflows/release-graph.yml`, `.pre-commit-config.yaml`, `.gitignore`, `.dockerignore`, `ARCHITECTURE.md`, `README.md`
     【修改目的】将 Python 项目配置完全替换为 Node.js/TypeScript 配置
     【修改方式】修改现有配置文件
     【相关依赖】无
     【修改内容】
        - 修改 `Dockerfile`：FROM python:3.12-slim → FROM node:20-slim；pip install → pnpm install；ENTRYPOINT 从 `python -m graphify.serve` → `node dist/cli.js serve`；添加 pnpm install --frozen-lockfile 构建步骤；保留非 root user 和 EXPOSE 8080 配置
        - 修改 `.github/workflows/ci.yml`：Python setup → Node.js setup（actions/setup-node@v4）；uv sync → pnpm install；pytest → pnpm test；uv run graphify --help → pnpm exec graphify --help；移除 skillgen-check 中的 python -m 调用，替换为 pnpm exec skillgen --check；更新 security-scan job 的 Python 工具为 Node.js 等效工具
        - 修改 `.github/workflows/release-graph.yml`：Python 发布流程 → npm publish / GitHub Release 流程
        - 修改 `.pre-commit-config.yaml`：将 `python -m tools.skillgen --check` 替换为 `pnpm exec skillgen --check`；将 ruff hook 替换为 eslint/prettier hook（或移除 ruff 配置）
        - 修改 `.gitignore`：删除 Python 专属条目（`__pycache__/`, `*.pyc`, `*.egg-info/`, `.eggs/`, `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/`, `*.so`, `*.egg`, `venv/`, `.venv/`, `env/`），确认已有 `dist/`，补充 `node_modules/`
        - 修改 `.dockerignore`：移除 Python 相关条目（如有），补充 `node_modules/`, `src/`（仅发布 dist）
        - 更新 `ARCHITECTURE.md`：技术栈描述从 Python 改为 TypeScript，依赖列表从 pip 改为 npm
        - 更新 `README.md`：安装命令从 pip install 改为 pnpm add / npx，使用示例从 Python 改为 Node.js

- [ ] 6.3 删除所有 Python 代码
     【目标对象】`graphify/`, `tests/*.py`, `tools/skillgen/__init__.py`, `tools/skillgen/__main__.py`, `tools/__init__.py`, `pyproject.toml`, `tests/__init__.py`, `tests/conftest.py`, `tests/bench_extract.py`
     【修改目的】在 TS 版本完整验证后，删除所有 Python 源码和配置
     【修改方式】删除文件和目录
     【相关依赖】所有 TS 模块已完成并通过测试
     【修改内容】
        - 删除 `graphify/` 目录（所有 .py 文件及子目录）
        - 删除 `pyproject.toml`
        - 删除 `tests/` 中所有 .py 测试文件（`tests/__init__.py`, `tests/conftest.py`, `tests/bench_extract.py` 及所有 `test_*.py`）
        - 删除 `tools/skillgen/` 中 Python 文件（`__init__.py`, `__main__.py`）
        - 删除 `tools/__init__.py`
        - 删除 Python 相关 CI 缓存和虚拟环境配置（`uv.lock` 如存在）

- [ ] 6.4 端到端验证
     【目标对象】`package.json`, `src/index.ts`, `dist/`
     【修改目的】验证 TS 版本功能完整性，确保所有 CLI 命令、MCP 服务、skill 安装系统正常工作
     【修改方式】运行构建和测试验证
     【相关依赖】无
     【修改内容】
        - 运行 `pnpm build`：确认 tsup 构建成功，产物输出到 `dist/`
        - 运行 `pnpm test`：确认 vitest 全量测试通过
        - 手动验证核心 CLI 命令：`npx graphify extract`, `npx graphify update`, `npx graphify cluster-only`, `npx graphify query`, `npx graphify path`, `npx graphify explain`, `npx graphify export`
        - 验证 MCP 服务：`npx graphify serve` 启动 stdio 模式，`npx graphify serve --transport http --port 8080` 启动 HTTP 模式
        - 验证 skill 安装：`npx graphify install claude` / `npx graphify install cursor` 等
        - 验证 `graphify/__init__.py` 的延迟导入映射已在 `src/index.ts` 中完整体现（见任务 1.7）

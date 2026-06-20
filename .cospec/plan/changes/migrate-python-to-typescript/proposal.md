# 变更：将 graphify 项目从 Python 渐进迁移至 TypeScript

## 原因
graphify 项目当前使用 Python 实现（36,693行代码，30+核心模块，90+测试文件），需要将其整体迁移至 TypeScript 以获得更好的类型安全、npm 生态兼容性和前后端统一语言栈。采用渐进迁移策略，先搭建 TS 骨架，逐步替换 Python 模块，两版本共存过渡直至 Python 代码完全移除。

## 变更内容
- 搭建 TypeScript 项目骨架（pnpm + tsup + commander.js + tsconfig）
- 定义核心 TypeScript 类型/接口系统（替换 Python dataclass/dict）
- 使用 web-tree-sitter（WASM绑定）替代 Python tree-sitter 绑定
- 使用 graphology 替代 NetworkX 实现图数据结构和算法
- 使用 @modelcontextprotocol/sdk 重写 MCP 服务模块
- 使用 openai / @anthropic-ai/sdk / @aws-sdk/client-bedrock-runtime 等重写 LLM 后端
- 使用 commander.js 重写 CLI 入口（替代手动 sys.argv 解析）
- 使用 vitest 替代 pytest 重写测试套件
- 按依赖顺序渐进迁移所有核心模块：detect → extract → build → cluster → analyze → report → export
- 迁移辅助模块：cache, dedup, validate, hooks, watch, prs, affected, querylog 等
- 迁移 skill 安装系统和 skillgen 工具
- 更新 Dockerfile 和 CI/CD 配置（Node.js 替代 Python）
- 最终删除所有 Python 代码和 pyproject.toml

## 技术决策摘要
| 领域 | Python 原实现 | TypeScript 替代方案 |
|------|-------------|-------------------|
| 包管理/构建 | pyproject.toml / setuptools | pnpm + tsup |
| AST 解析 | tree-sitter Python 绑定 | web-tree-sitter (WASM) |
| 图数据结构 | NetworkX | graphology |
| 社区检测 | graspologic (Leiden) / networkx (Louvain) | graphology-communities-louvain + 自行实现 Leiden |
| CLI 框架 | sys.argv 手动分发 | commander.js |
| MCP 服务 | 自实现 stdio/HTTP | @modelcontextprotocol/sdk |
| LLM 后端 | openai/anthropic/boto3 SDK | openai / @anthropic-ai/sdk / @aws-sdk/client-bedrock-runtime |
| 测试 | pytest | vitest |
| 进程调用 | subprocess | child_process |
| PDF 处理 | pypdf | pdf-parse |
| Office 处理 | python-docx / openpyxl | mammoth / exceljs |
| Token 计数 | tiktoken | js-tiktoken |
| 序列化 | nx.node_link_data | graphology-operators + 自定义 JSON |

## 迁移阶段划分

### 阶段1：基础设施搭建（TS骨架 + 类型系统 + 核心依赖集成）
- TS 项目初始化（tsconfig, pnpm, tsup, vitest）
- 核心 interface/type 定义（ExtractionResult, GraphNode, GraphEdge, LanguageConfig 等）
- web-tree-sitter 集成和 grammar 加载层
- graphology 图适配层
- commander.js CLI 骨架

### 阶段2：核心管线迁移（按依赖顺序）
- detect → validate → cache → extract → build → cluster → analyze → report → export

### 阶段3：辅助模块迁移
- dedup, symbol_resolution, file_slice, _minhash
- llm（LLM 后端）, semantic_cleanup
- hooks, watch, prs, affected, querylog
- callflow_html, tree_html, wiki

### 阶段4：服务与集成迁移
- serve（MCP 服务）, mcp_ingest
- ingest, global_graph, manifest
- cargo_introspect, pg_introspect, scip_ingest
- google_workspace, security, diagnostics, benchmark
- transcribe

### 阶段5：CLI 与安装系统迁移
- __main__ CLI 完整命令迁移
- skill 安装/卸载系统
- skillgen 工具

### 阶段6：测试套件迁移 + Python 清理
- 全部测试迁移至 vitest
- 删除 Python 代码和 pyproject.toml
- 更新 Dockerfile / CI/CD

## 影响
- **受影响的规范**：全部核心管线、CLI、MCP 服务、LLM 集成、测试
- **受影响的代码**：
    - `graphify/__init__.py`: 包入口，延迟导入映射 → TS 模块导出
    - `graphify/__main__.py`: CLI 入口（4745行）→ commander.js 命令
    - `graphify/extract.py`: 核心提取引擎（12892行）→ src/extract/ 多文件模块
    - `graphify/llm.py`: LLM 后端（2263行）→ src/llm/ 多文件模块
    - `graphify/serve.py`: MCP 服务（1325行）→ src/serve/
    - `graphify/detect.py`: 文件检测（1432行）→ src/detect.ts
    - `graphify/export.py`: 多格式导出（1523行）→ src/export/
    - `graphify/build.py`: 图构建（597行）→ src/build.ts
    - `graphify/cluster.py`: 社区检测（331行）→ src/cluster.ts
    - `graphify/analyze.py`: 图分析（732行）→ src/analyze.ts
    - `graphify/report.py`: 报告生成（485行）→ src/report.ts
    - `graphify/cache.py`: 缓存系统（475行）→ src/cache.ts
    - `graphify/dedup.py`: MinHash去重（550行）→ src/dedup.ts
    - `graphify/symbol_resolution.py`: 符号解析（538行）→ src/symbolResolution.ts
    - `graphify/hooks.py`: Git钩子（267行）→ src/hooks.ts
    - `graphify/watch.py`: 文件监视（968行）→ src/watch.ts
    - `graphify/prs.py`: PR分析（751行）→ src/prs.ts
    - `graphify/affected.py`: 影响分析（276行）→ src/affected.ts
    - `graphify/validate.py`: 验证（287行）→ src/validate.ts
    - `graphify/querylog.py`: 查询日志（208行）→ src/querylog.ts
    - `graphify/callflow_html.py`: 调用流HTML（2020行）→ src/callflowHtml.ts
    - `graphify/tree_html.py`: 目录树HTML（582行）→ src/treeHtml.ts
    - `graphify/wiki.py`: Wiki导出（350行）→ src/wiki.ts
    - `graphify/ingest.py`: 外部仓库摄入 → src/ingest.ts
    - `graphify/global_graph.py`: 全局图管理 → src/globalGraph.ts
    - `graphify/manifest.py`: 增量检测 → src/manifest.ts
    - `graphify/cargo_introspect.py`: Cargo项目内省 → src/cargoIntrospect.ts
    - `graphify/pg_introspect.py`: Postgres内省 → src/pgIntrospect.ts
    - `graphify/scip_ingest.py`: SCIP索引摄入 → src/scipIngest.ts
    - `graphify/mcp_ingest.py`: MCP配置提取 → src/mcpIngest.ts
    - `graphify/google_workspace.py`: Google Workspace → src/googleWorkspace.ts
    - `graphify/security.py`: 安全扫描 → src/security.ts
    - `graphify/diagnostics.py`: 诊断工具 → src/diagnostics.ts
    - `graphify/benchmark.py`: 基准测试 → src/benchmark.ts
    - `graphify/transcribe.py`: 视频转录 → src/transcribe.ts
    - `graphify/semantic_cleanup.py`: 语义清理 → src/semanticCleanup.ts
    - `graphify/multigraph_compat.py`: 多图兼容 → src/multigraphCompat.ts
    - `graphify/_minhash.py`: MinHash实现 → src/minhash.ts
    - `graphify/file_slice.py`: 文件切片 → src/fileSlice.ts
    - `tests/`: 全部测试文件 → tests/ (vitest)
    - `tools/skillgen/`: skill生成器 → tools/skillgen/
    - `Dockerfile`: Python → Node.js
    - `pyproject.toml`: → package.json + tsconfig.json

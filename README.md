# Graphify (TypeScript)

> 将代码、文档、PDF、图片等文件转化为可查询的知识图谱 — TypeScript 重构版

Graphify 是一个 AI 编程助手技能与 CLI 工具，它能将任意文件夹中的代码、文档、论文、图片和视频映射为可查询的知识图谱。你无需逐文件 grep，而是直接对图谱发起查询。

本项目是从原始 [Graphify](https://github.com/safishamsi/graphify) Python 版本重写为 TypeScript 的工程，保留了核心管线逻辑，同时利用 Node.js 生态和 `graphology` 图库实现了更轻量的运行时。

---

## 特性

- 🔍 **AST 级代码提取** — 基于 tree-sitter WASM，支持 20+ 种编程语言的类、函数、导入、调用图等结构化提取，完全离线，无 API 调用
- 🧠 **LLM 语义提取** — 支持文档、PDF、图片的语义节点/关系提取，兼容 OpenAI、Anthropic Claude、Azure OpenAI、AWS Bedrock、Ollama 等多种后端
- 🕸️ **知识图谱构建** — 基于 `graphology` 高性能图库，支持 Louvain / Leiden 社区检测
- 📊 **可视化导出** — HTML 交互式图谱、GraphML (Gephi)、Cypher (Neo4j/FalkorDB)、SVG、Obsidian Canvas、Markdown Wiki
- 🔌 **MCP 服务器** — 通过 stdio / HTTP 传输提供 `query_graph`、`get_node`、`shortest_path` 等工具
- 🤖 **多平台技能注册** — 一键安装至 Claude Code、Codex、Cursor、Gemini CLI、Kilo、Aider 等 20+ 种 AI 编程助手
- 🔄 **增量更新** — SHA256 缓存 + `--update` 增量提取，仅重新处理变更文件
- 🛡️ **安全设计** — URL 校验、路径验证、标签清洗、SSRF 防护

---

## 工作原理

```
detect()  →  extract()  →  build_graph()  →  cluster()  →  analyze()  →  report()  →  export()
```

1. **检测** — 扫描目录，收集支持的文件类型，遵循 `.gitignore` / `.graphifyignore`
2. **提取** — 代码文件走 tree-sitter AST 提取（离线）；文档/图片走 LLM 语义提取
3. **构建** — 将所有提取结果合并为 `graphology` 有向图
4. **聚类** — Louvain / Leiden 社区检测，为节点分配社区标签
5. **分析** — 识别 God Node（核心节点）、意外关联、建议查询问题
6. **报告** — 生成 `GRAPH_REPORT.md`
7. **导出** — 输出 `graph.html`、`graph.json`、Obsidian vault 等

运行后生成三个核心文件：

```
graphify-out/
├── graph.html       # 浏览器打开 — 可点击节点、搜索、筛选
├── GRAPH_REPORT.md  # 摘要：核心概念、意外关联、建议问题
└── graph.json       # 完整图谱 — 随时查询，无需重新读取文件
```

---

## 支持的语言

| 类型 | 扩展名 |
|------|--------|
| Python | `.py` |
| JavaScript / TypeScript | `.js .jsx .mjs .ts .tsx` |
| Go | `.go` |
| Rust | `.rs` |
| Java | `.java` |
| C / C++ | `.c .cpp .h .hpp` |
| C# | `.cs` |
| Ruby | `.rb` |
| Kotlin | `.kt .kts` |
| Scala | `.scala` |
| Swift | `.swift` |
| PHP | `.php` |
| Lua | `.lua` |
| Dart | `.dart` |
| Elixir | `.ex .exs` |
| Groovy | `.groovy .gradle` |
| Bash | `.sh .bash` |
| Julia | `.jl` |
| Zig | `.zig` |
| 文档 | `.md .mdx .html .txt .rst .yaml .yml .json` |
| PDF | `.pdf` |
| Office | `.docx .xlsx` |
| 图片 | `.png .jpg .webp .gif` |

> 代码文件通过 tree-sitter WASM 在本地提取，不发送任何 API 请求。仅文档、PDF、图片等需要 LLM 后端。

---

## 安装

### 前置要求

- **Node.js** 18+ （推荐 20+）
- **pnpm** （项目使用 pnpm workspace）

### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/safishamsi/graphify.git
cd graphify

# 安装依赖
pnpm install

# 构建
pnpm build

# CLI 全局链接（可选）
pnpm link --global
```

构建完成后，CLI 可通过 `graphify` 命令使用。

---

## 快速开始

### 构建知识图谱

```bash
# 为当前目录构建图谱
graphify extract .

# 增量更新（仅重新提取变更文件）
graphify extract . --update

# 仅重新聚类（不重新提取）
graphify cluster-only .

# 跳过 HTML 可视化
graphify extract . --no-viz
```

### 查询图谱

```bash
# 自由查询
graphify query "认证流程是如何连接到数据库的？"

# 查找两个节点之间的路径
graphify path "UserService" "DatabasePool"

# 解释某个节点
graphify explain "RateLimiter"
```

### 导出

```bash
# Mermaid 架构/调用流 HTML
graphify export callflow-html

# Neo4j Cypher
graphify export neo4j

# FalkorDB
graphify export falkordb

# GraphML (Gephi / yEd)
graphify export graphml

# Obsidian vault
graphify export obsidian
```

### MCP 服务器

```bash
# stdio 传输（默认）
graphify serve graphify-out/graph.json

# HTTP 传输（团队共享）
graphify serve graphify-out/graph.json --transport http --port 8080

# 带鉴权的 HTTP 服务
graphify serve graphify-out/graph.json --transport http --host 0.0.0.0 --api-key "$SECRET"
```

MCP 服务器提供以下工具：`query_graph`、`get_node`、`get_neighbors`、`shortest_path`。

---

## AI 助手集成

一键注册 Graphify 技能到你的 AI 编程助手：

```bash
# 通用安装（自动检测平台）
graphify install

# 指定平台
c    # Claude Code
graphify install --platform codex      # Codex
graphify install --platform cursor     # Cursor
graphify install --platform gemini     # Gemini CLI
graphify install --platform kilo       # Kilo Code
graphify install --platform aider      # Aider
graphify install --platform opencode   # OpenCode
```

安装后，在 AI 助手中输入 `graphify .` 即可自动构建图谱并查询。

卸载：

```bash
graphify uninstall              # 从所有平台移除
graphify uninstall --purge      # 同时删除 graphify-out/
```

---

## LLM 后端配置

语义提取（文档/图片/PDF）需要 LLM 后端，通过环境变量配置：

| 变量 | 用途 | 后端 |
|------|------|------|
| `ANTHROPIC_API_KEY` | Anthropic Claude | `--backend claude` |
| `OPENAI_API_KEY` | OpenAI 或兼容 API | `--backend openai` |
| `OPENAI_BASE_URL` | OpenAI 兼容服务端 URL（vLLM, LM Studio…） | `--backend openai` |
| `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT` | Azure OpenAI | `--backend azure` |
| `AWS_*` / `~/.aws/credentials` | AWS Bedrock（IAM 鉴权，无需 API Key） | `--backend bedrock` |
| `OLLAMA_BASE_URL` | Ollama 本地推理 | `--backend ollama` |
| `DEEPSEEK_API_KEY` | DeepSeek | `--backend deepseek` |

```bash
# 示例：使用 Anthropic 后端提取文档
ANTHROPIC_API_KEY=sk-... graphify extract ./docs --backend claude

# 示例：使用 Ollama 本地推理
graphify extract ./docs --backend ollama

# 示例：使用 OpenAI 兼容服务
OPENAI_BASE_URL=http://localhost:8080/v1 OPENAI_MODEL=my-model graphify extract ./docs --backend openai
```

> 代码提取（AST）无需任何 API Key，完全离线运行。

---

## 常用环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `GRAPHIFY_MAX_WORKERS` | AST 并行线程数 | 自动 |
| `GRAPHIFY_MAX_OUTPUT_TOKENS` | LLM 输出 token 上限 | `16384` |
| `GRAPHIFY_API_TIMEOUT` | HTTP 调用超时（秒） | `600` |
| `GRAPHIFY_FORCE` | 强制重建图谱 | `false` |
| `GRAPHIFY_QUERY_LOG_DISABLE` | 禁用查询日志 | `false` |

---

## 项目结构

```
src/
├── cli.ts                  # CLI 入口
├── index.ts                # 库入口（公共 API 导出）
├── cli/
│   ├── index.ts            # Commander 程序定义
│   └── commands/           # 各 CLI 子命令
├── extract/                # AST 提取引擎
│   ├── index.ts            # 提取主入口
│   ├── ast-extract.ts      # tree-sitter AST 解析
│   ├── framework.ts        # 提取框架函数
│   └── registry.ts         # 语言提取器注册表
├── graph/                  # 图操作
│   ├── factory.ts          # graphology 图工厂
│   ├── operations.ts       # 节点/边操作
│   ├── community.ts        # Louvain / Leiden 社区检测
│   └── paths.ts            # 最短路径
├── tree-sitter/            # tree-sitter WASM 封装
│   ├── grammars.ts         # WASM 语法映射
│   ├── parser.ts            # 解析器封装
│   └── language-config.ts  # 语言配置
├── llm/                    # LLM 后端
│   ├── backends.ts         # 后端调度
│   ├── anthropic.ts        # Anthropic SDK
│   ├── openai-compat.ts    # OpenAI 兼容
│   ├── azure.ts            # Azure OpenAI
│   ├── bedrock.ts          # AWS Bedrock
│   └── ...
├── serve/                  # MCP 服务器
│   ├── server.ts           # MCP 工具注册
│   ├── query-engine.ts     # 查询引擎
│   └── transport.ts        # stdio / HTTP 传输
├── export/                 # 导出格式
│   ├── html.ts             # 交互式 HTML
│   ├── graphml.ts          # GraphML
│   ├── neo4j.ts            # Neo4j Cypher
│   ├── obsidian.ts         # Obsidian vault
│   └── ...
├── install/                # AI 助手技能安装
├── types/                  # TypeScript 类型定义
└── tests/                  # 测试文件
```

---

## 开发

### 构建

```bash
pnpm build          # tsup 构建 → dist/
```

### 测试

```bash
pnpm test           # vitest watch 模式
pnpm test:run       # vitest 单次运行
pnpm test:coverage  # 带覆盖率报告
```

### 技术栈

| 层面 | 选型 |
|------|------|
| 语言 | TypeScript 5.8+ (ES2022, ESM) |
| 构建 | tsup |
| 包管理 | pnpm |
| 图库 | graphology + graphology-communities-louvain |
| AST 解析 | web-tree-sitter (WASM) |
| CLI | commander |
| LLM | @anthropic-ai/sdk, openai, @aws-sdk/client-bedrock-runtime |
| MCP | @modelcontextprotocol/sdk |
| 校验 | zod |
| 测试 | vitest |

---

## 从 Python 到 TypeScript

本项目从原始 Python 版本 (`graphify/` 目录保留为参考) 重写而来，核心变更：

| Python 原版 | TypeScript 重写 |
|-------------|----------------|
| NetworkX | graphology |
| tree-sitter Python 绑定 | web-tree-sitter (WASM) |
| argparse / click | commander |
| pytest | vitest |
| ProcessPoolExecutor | worker_threads（规划中） |
| setuptools / pyproject.toml | tsup / package.json |

> `graphify/` 目录为原始 Python 源码，保留作为逻辑参考。所有运行时代码已迁移至 `src/`。

---

## 置信度标签

| 标签 | 含义 |
|------|------|
| `EXTRACTED` | 关系在源码中明确存在（如 import 语句、直接调用） |
| `INFERRED` | 合理推断的关系，附带 0.0–1.0 置信度分数 |
| `AMBIGUOUS` | 不确定的关系，在报告中标记供人工审查 |

---

## 忽略文件

创建 `.graphifyignore` — 语法与 `.gitignore` 一致，包括 `!` 否定：

```
# .graphifyignore
node_modules/
dist/
*.generated.ts

# 仅索引 src/ 目录
*
!src/
!src/**
```

`.gitignore` 自动生效。`.graphifyignore` 额外叠加，其规则优先级更高。

---

## Docker

```bash
docker build -t graphify .
docker run -p 8080:8080 -v "$(pwd)/graphify-out:/data" graphify \
  /data/graph.json --transport http --host 0.0.0.0 --api-key "$SECRET"
```

---

## 许可证

[MIT License](LICENSE) © 2026 Safi Shamsi

---

## 致谢

本项目基于 [Graphify](https://github.com/safishamsi/graphify) (Python) 由 Safi Shamsi 开发。TypeScript 重写版本保留了原始设计理念与管线架构。

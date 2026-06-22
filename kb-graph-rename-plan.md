# /graphify 用户命令重命名为 /kb-graph 实施计划
## Context
本次变更需将面向用户的斜杠命令（slash command）从 `/graphify` 调整为 `/kb-graph`，用户可在 CoStrict / Claude / Codex / Kilo 等平台输入新命令唤起知识图能力。

**内部底层契约全部保持不变**，不受本次更名影响：
1. Python CLI 入口名称仍为 `graphify`
2. Skill 唯一标识（skill identity）仍为 `graphify`
3. 包名、模块路径、安装目录结构不变
4. 输出目录 `graphify-out/`、缓存目录命名不变
5. 所有 `GRAPHIFY_*` 前缀环境变量不改动

该隔离方案可最大程度降低迁移风险，不破坏存量 CLI、钩子脚本、Skill 安装路径与各类测试契约。

## Recommended Approach
### 1. 修改 skillgen 生成源头，禁止手动维护产物
所有面向用户的命令文案统一从生成模板修改，不直接编辑生成后的 MD 文件：
- 修改 `tools/skillgen/fragments/**` 下全部用户可见文案：标题、Usage、命令示例、提示文本中的 `/graphify` 替换为 `/kb-graph`
  核心目录文件清单：
  - `tools/skillgen/fragments/core/core.md`
  - `tools/skillgen/fragments/query-stub/default.md`
  - `tools/skillgen/fragments/references/query/default.md`
  - `tools/skillgen/fragments/references/shared/*.md`
  - `tools/skillgen/fragments/dispatch/*.md`
  - `tools/skillgen/fragments/always-on/*.md`
- 修改 `tools/skillgen/gen.py` 内常量 `_TRAE_PRETOOLUSE_NOTE`，用户提示更新为 `/kb-graph --update`
- 保留 `tools/skillgen/platforms.toml` 配置：`name = graphify`、`skill_dst`、`refs_dst` 及全部 `graphify` 目录布局不改动

### 2. 更新安装注册逻辑，维持原有 Skill Identity
仅修改对外展示文案，底层绑定标识不变：
- 修改 `graphify/__main__.py` 中 `_skill_registration()`：对外注册文案展示 `/kb-graph`，底层仍绑定 `skill: "graphify"`
- 统一更新安装、卸载、帮助弹窗内面向终端用户的 `/graphify` 提示文本
- Skill 本地安装路径完全不变：`.claude/`、`.codex/` 等配置目录下 `skills/graphify/SKILL.md` 路径保留

### 3. 适配 Kilo 平台原生命令文件
Kilo 命令文件文件名决定平台识别的 slash 指令，需调整安装目标文件：
- 当前逻辑：`graphify/__main__.py` 安装脚本生成 `~/.config/kilo/command/graphify.md`，模板源为 `graphify/command-kilo.md`
- 调整方案：
  1. 安装/卸载目标文件改为 `~/.config/kilo/command/kb-graph.md`
  2. 模板文件仍复用 `graphify/command-kilo.md`，不新增模板
  3. 修改 `command-kilo.md` 内部所有用户可见命令为 `/kb-graph`，底层调用仍指向 `graphify` Skill / CLI
- 兼容策略：不会静默删除用户本地旧 `graphify.md`，仅新安装流程管理 `kb-graph.md`，存量旧文件由用户自行处理

### 4. 全局更新运行时提示与用户文档
仅替换**用户输入指令提示**，底层代码标识、路径、目录名不改动：
1. 运行时代码提示修改范围：
   - `graphify/security.py`
   - `graphify/export.py`
   - `graphify/serve.py`
   - `graphify/hooks.py`
   仅修改 `Run /graphify ...` 这类展示给用户的提示字符串
2. 常驻能力文档：
   - `graphify/always_on/agents-md.md`
   - `graphify/always_on/vscode-instructions.md`
   对外说明统一使用 `/kb-graph`，内部引用 `skill: "graphify"` 不变
3. 项目公开文档：
   - 根目录 `README.md`
   - 多语言文档 `docs/translations/README.*.md`
   - 示例仓库文档 `worked/karpathy-repos/README.md`
   所有命令示例替换为 `/kb-graph`
4. 历史记录豁免：不批量修改 `CHANGELOG.md`，文件内保留原始 `graphify` CLI、包名、`graphify-out/`、`graphify query` 等底层真实命令示例

### 5. 重新生成自动产物与测试快照
修改模板后刷新全部自动生成文件，同步更新测试预期快照：
1. 刷新 Skill 生成产物
   ```bash
   python -m tools.skillgen
   ```
   刷新范围：
   - `graphify/skill*.md`
   - `graphify/skills/*/references/*.md`
   - `graphify/always_on/*.md`
2. 同步更新测试预期快照
   ```bash
   python -m tools.skillgen --bless
   ```
   刷新 `tools/skillgen/expected/graphify__*.md`
3. Diff 校验：仅允许用户可见 slash 命令 `/graphify → /kb-graph`，禁止误改 CLI 名称、包名、Skill ID、输出目录、钩子逻辑

### 6. 更新全部测试断言
区分两类测试：用户交互文案测试需更名，底层 CLI 功能测试保持 `graphify`：
1. 文案断言修改：
   - `tests/test_skillgen.py`：所有 `## For /graphify query/path/explain` 断言改为 `/kb-graph`
   - `tests/test_install.py`：更新注册文案、Kilo 命令文件路径断言，校验目标文件 `kb-graph.md`，同时校验 Skill 安装路径仍为 `graphify/SKILL.md`
   - 配套安装全链路测试同步修正：
     `tests/test_install_strings.py`、`tests/test_install_references.py`、`tests/test_install_roundtrip.py`、`tests/test_install_upgrade.py`、`tests/test_codebuddy.py`、`tests/test_devin.py`
2. 底层 CLI 测试保留原名称：所有校验真实命令行入参、`graphify query`、`graphify update .` 等逻辑的测试不做修改

## Critical Files
1. `graphify/__main__.py`：注册函数、Kilo 命令文件路径、安装提示文案
2. `tools/skillgen/gen.py`：硬编码用户提示常量 `_TRAE_PRETOOLUSE_NOTE`
3. `tools/skillgen/fragments/**`：Skill 文档生成源模板
4. `graphify/command-kilo.md`：Kilo 平台命令模板
5. 运行时提示代码：`graphify/security.py`、`graphify/export.py`、`graphify/serve.py`、`graphify/hooks.py`
6. 自动生成产物：`graphify/skill*.md`、`graphify/skills/*/references/*.md`、`graphify/always_on/*.md`
7. 测试快照：`tools/skillgen/expected/graphify__*.md`
8. 用户对外文档：`README.md`、`docs/translations/README.*.md`、`worked/karpathy-repos/README.md`
9. 测试用例：`tests/test_skillgen.py`、`tests/test_install*.py`、`tests/test_codebuddy.py`、`tests/test_devin.py`

## Reuse Existing Utilities
复用现有工具链，不新增抽象与脚本：
1. 产物管理工具：
   ```bash
   python -m tools.skillgen
   python -m tools.skillgen --check
   python -m tools.skillgen --bless
   ```
   复用内置 `render_all()` / `check()` / `audit_coverage()` 方法
2. Skill 注册统一入口：沿用 `graphify.__main__._skill_registration()` 作为所有平台注册文案唯一来源
3. Kilo 安装逻辑：复用现有文件复制分支，仅修改目标输出文件名
4. 测试体系：沿用现有安装、产物、平台差异化校验用例，不新增底层测试框架

## Verification
### 1. 生成产物校验
```bash
# 刷新产物
python -m tools.skillgen
# 更新快照
python -m tools.skillgen --bless
# 一致性校验
python -m tools.skillgen --check
```

### 2. 执行核心测试用例
```bash
# 基础核心测试
python -m pytest tests/test_skillgen.py tests/test_install.py tests/test_install_strings.py

# 按需执行全量安装链路测试
python -m pytest tests/test_install_references.py tests/test_install_roundtrip.py tests/test_install_upgrade.py tests/test_codebuddy.py tests/test_devin.py
```

### 3. 冒烟测试（CLI 底层能力不变验证）
```bash
python -m graphify --help
python -m graphify install --help
```

### 4. 全局文本检索全覆盖校验
```bash
# 检索遗留旧用户命令，区分可保留底层标识与需替换文案
rg '/graphify|Usage: /graphify|Run /graphify|Trigger: /graphify|graphify.md' .
```
检索结果分类处理：历史文档、底层CLI/路径契约、兼容说明、遗漏待修改文案
```bash
# 校验新命令全覆盖
rg '/kb-graph|kb-graph.md' .
```
预期覆盖范围：Skill 生成文档、注册安装文案、Kilo 命令文件、常驻功能指引、README 文档、全部测试断言

### 5. 项目知识图同步
代码修改全部完成后，刷新项目知识索引：
```bash
graphify update .
```

### 6. 大范围变更后置核验
若本次改动文件量级较大，变更落地后启动独立核验 Agent，传入原始需求、全部变更文件、完整校验命令，依据 Agent 核验结论确认任务完成状态。

## Risk Controls
1. **禁止全局批量替换字符串 `graphify`**，仅精准替换面向用户的斜杠指令 `/graphify`
2. 永久保留底层标识：`skill: "graphify"`、CLI 命令 `graphify`、包/模块名、安装目录、`graphify-out/`、`GRAPHIFY_*` 环境变量
3. 底层逻辑完全不动：钩子事件名、PreToolUse / BeforeTool 生命周期语义、Git Hook 执行逻辑、安全校验、查询日志数据结构
4. 所有对外文档必须从 `skillgen` 源头模板修改，禁止直接编辑生成产物，避免下次脚本生成覆盖回退修改
5. Kilo 平台仅新增 `kb-graph.md`，不主动删除用户本地存量 `graphify.md` 文件，保证兼容不破坏用户环境
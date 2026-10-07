# Vue Universal Config Engine

Vue 3 高代码演化器 v0.6：让已有 Vue3 工程在**不重写源码**的前提下获得可配置、可审查、可回滚的演化能力，并进一步理解本地组件契约与依赖图。

> Source → Analyze → Sandbox → Edit Intent → Patch → Runtime → Verify → Snapshot / Rollback

## 这不是一个“Vue 转 JSON”工具

源码仍然是真相。低代码/配置层只是源码能力的投影。引擎能够理解的部分结构化为 Capability；无法可靠理解的部分保留为 BlackBox / Opaque，不猜测、不重写。

## v0.3 已实现

- pnpm 12 workspace
- Vue SFC / Template AST
- `<script setup>` 基础语义分析
- 项目级扫描和 Project Index
- Project-relative stable Node ID
- Local Vue component import resolution（relative + TSConfig paths）
- ant-design-vue 基础 Capability Registry
- HCP capability projection
- SAFE / ASSISTED / RISKY / REJECTED 安全策略
- `set-prop`
- `remove-prop`
- `set-binding`
- `set-event`
- `set-visibility`
- `set-text`
- `insert-child`
- `delete-node`
- 多文件 Evolution Transaction
- source hash 前置条件
- patch overlap 检测
- reparse gate
- pnpm-first typecheck / build gate
- inverse patch / rollback
- Evolution Journal / History
- Snapshot / Drift Status
- 项目 Markdown Report
- Fixture Regression

## v0.5 新增：真实代码沙盒

v0.5 开始不再把“页面还原”当成目标，而是直接运行真实 Vue 项目。源码仍然是唯一真相，Visual / AI 只是不同的编辑入口。

```text
Vue Project
   ↓
Sandbox Kernel
   ├─ package manager detection
   ├─ dependency prepare
   ├─ dev server lifecycle
   ├─ file read/write
   ├─ hash guarded EditIntent
   ├─ Snapshot / Restore
   └─ Diff
        ↓
AI / Human / Visual Inspector
```

当前版本提供：

- `@hcbridge/sandbox-kernel`：真实项目运行和文件演化内核
- `apps/sandbox`：本地 Sandbox Gateway + 浏览器工作台
- `sandbox edit-intent`：AI / 人工共用的安全修改协议
- Snapshot / Diff / Restore：用于实验性修改和回滚

> v0.5 的重点是“能把真实项目装进沙盒并安全修改”。浏览器 WebContainer 适配、Monaco 专业编辑器、运行时 DOM ↔ Vue AST 双向定位属于后续层，不在这一版伪造完成。

## 目录

```text
apps/
  cli/                       CLI

packages/
  source-model/              Source model & diagnostics
  source-locator/            Stable node/source identity
  vue-parser/                Vue SFC + template parser
  ts-analyzer/               script setup semantic scanner
  component-resolver/        local/external component resolution
  semantic-graph/            Semantic graph
  hcp/                       High-Code Capability Protocol
  capability-registry/       Component capability metadata
  patch-engine/              Minimal source-range patching
  evolution-engine/          Project-level transaction/orchestration
  verifier/                  Reparse/typecheck/build verification
  platform-contract/         Platform adapter contracts
  platform-adapter/          Demo platform adapter
  build-adapter-core/        Build adapter contract
  build-adapter-vite/        Vite detection adapter
  runtime-trace/             Runtime trace protocol skeleton
  sandbox-kernel/            Real project sandbox, edit intents and snapshots
  visual-inspector/          Runtime DOM → Vue source candidate locator

tests / fixtures/             Realistic regression samples
```

## 开发环境

- Node.js `>=22.13`
- pnpm `12.9.1`

```bash
corepack enable
corepack prepare pnpm@12.9.1 --activate
pnpm install
```

## CLI

### 1. 初始化项目

```bash
pnpm run cli -- init .
```

### 2. 检查环境

```bash
pnpm run cli -- doctor .
```

### 3. 扫描项目

```bash
pnpm run cli -- scan .
```

### 4. 生成项目索引 / 报告

```bash
pnpm run cli -- index .
pnpm run cli -- report .
```

默认生成：

```text
.hcbridge/
  config.json
  index.json
  report.md
  snapshot.json
  history/
```

### 5. 查看页面能力

```bash
pnpm run cli -- analyze src/views/UserList.vue
pnpm run cli -- inspect src/views/UserList.vue
pnpm run cli -- capabilities src/views/UserList.vue
pnpm run cli -- contract src/views/UserSelector.vue
pnpm run cli -- graph src/views/UserList.vue
```

### 6. 生成演化计划

```bash
pnpm run cli -- plan . fixtures/evolution/changes.example.json .hcbridge/evolution-plan.json
```

### 7. 只做计划，不改源码

```bash
pnpm run cli -- evolve . fixtures/evolution/changes.example.json --dry-run
```

### 8. 执行 SAFE 变更

```bash
pnpm run cli -- evolve . fixtures/evolution/changes.example.json --max-safety=SAFE
```

### 9. 允许结构型变更

```bash
pnpm run cli -- evolve . fixtures/evolution/changes.example.json --max-safety=ASSISTED
```

### 10. 严格验证

```bash
pnpm run cli -- evolve . fixtures/evolution/changes.example.json --max-safety=SAFE --verify
```

`--verify` 会额外执行：

```bash
pnpm exec vue-tsc --noEmit
pnpm exec vite build
```

### 11. 查看演化历史

```bash
pnpm run cli -- history .
```

### 12. 回滚某次演化

```bash
pnpm run cli -- rollback . .hcbridge/history/ev_xxx.json
```

## ChangeSet

```json
{
  "version": "0.3",
  "changes": [
    {
      "file": "src/views/UserList.vue",
      "nodeId": "node_xxx",
      "operation": "set-prop",
      "target": "type",
      "value": "primary"
    },
    {
      "file": "src/views/UserList.vue",
      "nodeId": "node_xxx",
      "operation": "set-binding",
      "target": "disabled",
      "value": "loading"
    }
  ]
}
```

## 安全模型

默认只执行 `SAFE`：

```text
SAFE       静态属性、绑定、事件、文本
ASSISTED   插入/删除节点
RISKY     v-if / 控制流
REJECTED  引擎无法可靠解释的语义
```

策略的核心是：

> 能证明安全，就自动执行；不能证明，就拒绝，而不是猜。

## 保真原则

一次属性演化应该产生类似：

```diff
- <a-button type="primary">
+ <a-button type="dashed">
```

而不是重新生成整页 `.vue`。

与目标范围无关的 template / script / style 文本必须保持不变。每个 Patch 都有 source hash 前置条件和 inverse plan；前置条件失效时拒绝执行。

## 当前边界

首期主路径：Vue 3 + Vite + TypeScript + `<script setup>` + template。

未知第三方组件、复杂 composable、动态组件、JSX/render function、Options API、任意 JS 语义降低，不会为了“转成低代码”而被强行重写。

## v0.5 Sandbox 使用

直接启动工作台：

```bash
pnpm run sandbox:fixture
```

然后访问 `http://127.0.0.1:4170`。

CLI 也可以直接检查和运行沙盒：

```bash
pnpm run cli -- sandbox doctor examples/antdv-vite
pnpm run cli -- sandbox prepare examples/antdv-vite
pnpm run cli -- sandbox run examples/antdv-vite
```

AI / 人工编辑统一走 EditIntent：

```json
{
  "actor": "ai",
  "description": "把查询按钮改成 primary",
  "expectedHashes": { "src/App.vue": "..." },
  "operations": [
    {
      "kind": "replace-text",
      "file": "src/App.vue",
      "oldText": "type=\"default\"",
      "newText": "type=\"primary\""
    }
  ]
}
```

## 下一阶段

1. Monaco 编辑器与专业 Diff UI
2. AI Agent：自然语言 → EditIntent → Patch → Build / Runtime Verify
3. WebContainer / Remote Container runtime adapter
4. Runtime component identity / Vue Devtools-compatible trace
5. 最后再考虑平台 Projection，而不是让平台 Schema 取代源码

## v0.6 新增：Visual Inspector

v0.6 在真实 Preview 上增加 Visual Inspector，把运行时 DOM 点击连接回 `.vue` 源码，但不虚构 100% 精确映射。

```text
Preview DOM
   ↓ postMessage
Inspector Bridge
   ↓
Visual Inspector
   ↓
Vue Template AST
   ↓
exact / relocated / ambiguous / lost
   ↓
SourceRange
   ↓
Editor selection
```

当前定位证据包含 tag、component alias、id、class、静态 attributes、href、文本与祖先结构。无法安全判断时保留候选，而不是猜测并修改源码。

启动：

```bash
pnpm run sandbox:fixture
```

然后点击 `Inspect`，在右侧真实 Preview 中选择元素；工作台会尝试打开对应 `.vue` 文件和源码范围。

详细设计见 `docs/evolver/v0.6-visual-inspector.md`。

## v0.4 Component Intelligence

当前版本在 v0.3 的安全演化闭环之上新增组件契约与本地组件依赖图：

```bash
pnpm run cli -- contract fixtures/local/UserSelector.vue
pnpm run cli -- graph fixtures/local/Parent.vue
```

组件契约可识别 `defineProps`、`defineEmits`、`defineModel`、`defineExpose`、`defineOptions({ name })`、`<slot>` 与 `defineSlots`；本地 Vue 组件会按 import 关系递归分析，并对循环、深度和文件数设置边界。

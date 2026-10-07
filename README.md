# Vue Universal Config Engine

Vue 3 高代码演化器：让已有 Vue3 工程在**不重写源码**的前提下获得可配置、可审查、可回滚的演化能力。

> Source → Analyze → Capability → EvolutionPlan → Minimal Patch → Reparse → Verify → Journal

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

## 下一阶段

下一阶段不是再加大量 directive，而是进入真实项目适配：

1. local component 递归分析
2. 更完整的类型/props/events/slots 提取
3. Pinia / Router / API capability graph
4. Platform Adapter 接入现有低代码平台
5. Code Inspector → Capability Inspector
6. Overlay 只在恒等变换 fixture 证明后进入

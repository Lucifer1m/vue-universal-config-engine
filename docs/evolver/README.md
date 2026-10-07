# High-Code Evolver v0.6

`@hcbridge/evolution-engine` 是项目级高代码演化层。它不是代码生成器，也不是把 Vue 页面整体收成 JSON；它负责让已有 Vue3 工程可被机器理解、局部配置和安全演化。

## Golden Path

```text
Project
  ↓
Scan + Project Index
  ↓
SFC / Template / Script analysis
  ↓
Component resolution
  ↓
Semantic Graph + HCP
  ↓
Evolution Intent / ChangeSet
  ↓
Safety classification
  ↓
EvolutionPlan
  ↓
Precondition + overlap validation
  ↓
Minimal AST/source-range patch
  ↓
Reparse verification
  ↓
Optional pnpm typecheck/build
  ↓
Commit journal
  ↓
Rollback / history
```

## 核心原则

1. **Source is Truth**：源码仍是唯一权威资产。
2. **Patch > Rewrite**：默认只修改目标源码区间。
3. **Safe Reject**：无法安全理解或定位时拒绝自动修改。
4. **BlackBox / Opaque**：未知组件和复杂业务逻辑保留，不强行结构化。
5. **Capability > Component**：低代码关心的是“可配置能力”，组件只是能力载体。
6. **Project Transaction**：多文件演化要么整体成功，要么恢复已改文件。
7. **Verification as Gate**：重新解析是默认门槛，类型检查和构建可以作为更严格门槛。

## 安全等级

| Level | 含义 | 默认行为 |
|---|---|---|
| SAFE | 局部属性、绑定、事件、文本变更 | 默认允许 |
| ASSISTED | 节点结构变化 | 显式放开 |
| RISKY | 控制流/可见性变化 | 显式放开 |
| REJECTED | 引擎没有可靠语义 | 永不自动执行 |

CLI 默认只执行 `SAFE`。

## 当前 ChangeSet

- `set-prop`
- `remove-prop`
- `set-text`
- `set-binding`
- `set-event`
- `set-visibility`
- `insert-child`
- `delete-node`

## 项目状态工件

`.hcbridge/` 默认维护：

- `config.json`：演化策略
- `index.json`：项目索引、页面统计和解析结果摘要
- `snapshot.json`：源码 hash + 节点快照
- `report.md`：覆盖情况
- `history/`：每次演化的 journal、diff、inverse plan、验证结果

## 一次真实演化

```bash
pnpm run cli -- scan .
pnpm run cli -- capabilities src/views/UserList.vue
pnpm run cli -- plan . changes.json .hcbridge/evolution-plan.json
pnpm run cli -- evolve . changes.json --max-safety=SAFE
pnpm run cli -- verify .
pnpm run cli -- history .
```

扩大允许范围：

```bash
pnpm run cli -- evolve . changes.json --max-safety=ASSISTED
```

只生成计划不修改源码：

```bash
pnpm run cli -- evolve . changes.json --dry-run
```

## 首期边界

首期主路径锁定 Vue3 + Vite + TypeScript + `<script setup>` + template。Local Vue component 已经可以通过 import + 相对路径/TSConfig paths 做解析，但复杂组件内部不做全量语义展开；未知第三方组件仍然可以作为 BlackBox 使用。

Nuxt、JSX/render function、Options API、动态组件、任意 JS 语义降低、三方自动 Merge、生产 Runtime Overlay 仍然不是本阶段承诺。

# v0.4 Component Intelligence

v0.4 在 v0.3 的安全演化之上增加组件契约和递归依赖图，不改变“源码为真相”的原则。

```bash
pnpm run cli -- contract fixtures/local/UserSelector.vue
pnpm run cli -- graph fixtures/local/Parent.vue
```

组件契约目前可识别：
- `defineProps<T>()` / `defineProps({})`
- `defineEmits([...])` / `defineEmits<T>()`
- `defineModel()`
- `defineExpose({})`
- `defineOptions({ name })`
- `<slot name="...">`
- `defineSlots<T>()`

递归图会跟踪本地 Vue import，检测循环并提供最大深度/最大文件数保护。无法解析的依赖不会阻塞其他节点分析。

# v0.5 Sandbox Kernel

v0.5 不再继续扩大“源码 → 平台 Schema”这条单向链路，而是把真实代码运行时纳入核心：

```text
Source
  ↓
Analyze / Component Intelligence
  ↓
Sandbox
  ↓
Human / AI EditIntent
  ↓
Patch / Runtime
  ↓
Verify / Snapshot / Restore
```

运行工作台：

```bash
pnpm run sandbox:fixture
```

直接用 CLI 验证 EditIntent：

```bash
pnpm run cli -- sandbox edit fixtures/sandbox/edit-intent.example.json examples/antdv-vite
```

注意：v0.5 的本地 runtime 是受信任开发环境，并不是多租户安全隔离沙盒。WebContainer、远程 container/VM、Monaco 与 Runtime DOM → SourceRef 定位留到后续 adapter / UI 阶段。

# v0.6 Visual Inspector

v0.6 把 Sandbox Preview 与源码建立第一条可用连接：

```text
Real Preview
   ↓
Inspector Bridge
   ↓
DOM signature
   ↓
Visual Inspector
   ↓
Vue Template AST
   ↓
exact / relocated / ambiguous / lost
   ↓
SourceRange
```

启动：

```bash
pnpm run sandbox:fixture
```

工作台点击 `Inspect` 后，在 Preview 中点一个元素；服务端扫描项目 `.vue` template 并返回候选。`exact` / `relocated` 才会自动定位源码；`ambiguous` / `lost` 只展示诊断和候选，不猜测。

命令行回归：

```bash
pnpm run inspect-runtime:fixture
```

当前 Proxy 只转发 HTTP，不转发 WebSocket，所以 Inspector 模式不保证 Vite HMR；这属于后续 Runtime Adapter 工作。

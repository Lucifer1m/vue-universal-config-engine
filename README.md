# Vue Universal Config Engine

Vue 3 高代码可配置化引擎的第一版可执行骨架，严格按 v1.0 方案收敛：

> Inspect → Plan → Patch → Reparse → Verify

本仓库首期不做新设计器、不做生产 Runtime Overlay、不做三方自动 Merge，也不尝试“任意 Vue 100% 自动反编译”。它的目标是证明一个可审查、可回滚、Git-friendly 的无损 Patch 闭环。

## 当前能力

- Vue SFC parsing：`@vue/compiler-sfc`
- Template AST：`@vue/compiler-dom`
- `<script setup lang="ts">` 基础分析：TypeScript AST
- Component / prop / text / v-model / v-if / v-for / event reference 识别
- HCP（High-Code Capability Protocol）投影
- Ant Design Vue v4 基础物料元数据：Button / Input / Select / Form / Table / Modal / Pagination
- SourceRef：offset / line / column / hash / syntax fingerprint
- Patch Engine：静态 prop、文本、v-model 的最小范围 patch
- Patch precondition、inverse patch、rollback
- Verify：reparse + 可选 `vue-tsc` / `vite build`
- Fixture runner 与 Vitest regression
- Platform Adapter / Build Adapter / Runtime Trace 的协议骨架

## 当前边界

MVP 锁定：Vue 3 + Vite + TypeScript + `<script setup>` + template。

复杂 composable、Pinia 全图、动态组件、JSX / render function、Options API、`eval` / DOM hack、动态 import 等会被识别为 Assisted / BlackBox / Opaque，不猜测。

## 快速开始

```bash
pnpm install
pnpm test
pnpm run typecheck
pnpm run inspect:fixture
pnpm run analyze:fixture
```

## CLI

```bash
pnpm run cli -- init
pnpm run cli -- analyze fixtures/basic/UserList.vue
pnpm run cli -- inspect fixtures/basic/UserList.vue
pnpm run cli -- plan fixtures/basic/UserList.vue fixtures/basic/change.json
pnpm run cli -- plan fixtures/basic/UserList.vue fixtures/basic/change.json .hcbridge/patch.json
pnpm run cli -- apply fixtures/basic/UserList.vue fixtures/basic/change.json
pnpm run cli -- rollback fixtures/basic/UserList.vue .hcbridge/rollback/<inverse>.json
pnpm run cli -- verify .
```

## 版本策略

这是工程 v0.1，采用 pnpm workspace；当前不是稳定 API。核心协议一旦准备冻结，再单独发布 HCP 0.1 / Source Model 0.1 / Patch Plan 0.1。

## 设计原则

1. Source is Truth
2. Patch > Rewrite
3. 无法安全定位就拒绝修改
4. 看不懂的代码进入 Opaque，不猜
5. LowCode Schema 只是 Projection
6. Fixture 先于新能力

## Package Manager

本仓库统一使用 pnpm workspace 管理。当前工程固定 `pnpm@12.9.1`；pnpm 12 要求 Node.js 22.13+。

安装依赖：

```bash
pnpm install
```

建议团队统一使用项目声明的 `pnpm@12.9.1`，避免不同 pnpm 主版本导致 lockfile 或 workspace 行为差异。

# High-Code Evolver

`@hcbridge/evolution-engine` 是仓库的项目级演化层。

## 工作流

```text
scan
  ↓
semantic model
  ↓
ChangeSet
  ↓
EvolutionPlan
  ↓
precondition check
  ↓
minimal patch
  ↓
reparse
  ↓
optional typecheck/build
  ↓
rollback journal
```

## 设计原则

- 源码不被 schema 替换。
- 变更尽量是局部 Patch，而不是整文件重写。
- 无法定位、前置 hash 失效、Patch 重叠、重新解析失败时拒绝提交。
- Unknown component / complex JS 保留为 BlackBox / Opaque。
- 项目级变更采用事务语义：任一文件失败，恢复本次已经修改的文件。

## ChangeSet

支持：

- `set-prop`
- `remove-prop`
- `set-binding`
- `set-event`
- `set-visibility`
- `set-text`
- `insert-child`
- `delete-node`

## 输出

`.hcbridge/` 默认包含：

- `config.json`：项目演化配置
- `snapshot.json`：源码 hash + 节点快照
- `index.json`：供平台消费的项目索引/HCP 投影
- `report.md`：项目覆盖率报告
- `rollback/`：本次演化的逆向 Patch 记录

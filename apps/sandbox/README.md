# HCBridge Sandbox

v0.6 的本地 Sandbox Gateway + Visual Inspector 工作台。

```bash
pnpm run sandbox:fixture
```

默认打开 `http://127.0.0.1:4170`。

提供：

- 文件浏览 / 读取 / 保存
- 本地 dev server start / stop
- Snapshot / Restore / Diff
- Human / AI 共用的 EditIntent API
- Visual Inspector：Preview DOM 点击 → `.vue` 候选源码定位
- `exact / relocated / ambiguous / lost` 状态

Visual Inspector 通过 gateway 代理 Preview HTML 并注入轻量 `postMessage` bridge。它只采集 DOM 特征，不修改目标项目源码。

> 当前 preview proxy 只代理 HTTP，不代理 WebSocket，因此 Inspector 模式不保证 Vite HMR。真正的安全隔离和完整 runtime adapter 将在后续版本实现。

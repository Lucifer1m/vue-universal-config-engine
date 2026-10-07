# HCBridge Sandbox

v0.5 的最小本地 Sandbox Gateway。

```bash
pnpm run sandbox:fixture
```

默认打开 `http://127.0.0.1:4170`。

它会创建一个受信任的本地 Sandbox Session，并提供：

- 文件浏览 / 读取 / 保存
- 本地 dev server start / stop
- Snapshot / Restore / Diff
- Human / AI 共用的 EditIntent API

当前版本故意不把本地 Node 进程伪装成多租户安全沙盒。需要真正的隔离执行时，将由后续 runtime adapter 接入 WebContainer 或远程 container/VM。

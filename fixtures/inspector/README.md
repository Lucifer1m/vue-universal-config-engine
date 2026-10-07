# Visual Inspector Fixture

用于不启动浏览器的定位回归：

```bash
pnpm run inspect-runtime:fixture
```

输入是一个模拟 Runtime DOM probe 的 JSON，输出会包含 `exact / relocated / ambiguous / lost` 状态、候选源码与 confidence。

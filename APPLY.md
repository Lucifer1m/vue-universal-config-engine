# v0.8 Overlay

目标基线：`main` 最新提交 `725057623a91430b14e38e0f950097363fd317e8`。

推荐方式：把本目录中的 `packages/llm-provider`、`docs/evolver/v0.8-llm-provider.md` 和 `scripts/apply-v0.8-overlay.mjs` 复制到最新仓库，然后在仓库根目录执行：

```bash
node scripts/apply-v0.8-overlay.mjs
pnpm install
pnpm run typecheck
pnpm run test
```

脚本会对 root package、CLI、Sandbox、root tsconfig、`.gitignore` 和 pnpm-lock importer 做最小化修改；如果锁文件格式或锚点已经变化，会提示并跳过可选 lockfile patch，此时直接执行 `pnpm install` 更新锁文件即可。

配置外部 LLM：

```bash
export HCBRIDGE_AGENT_ENDPOINT=http://127.0.0.1:3000/v1/chat/completions
export HCBRIDGE_AGENT_API_KEY=your-key
export HCBRIDGE_AGENT_MODEL=your-model
```

未配置 endpoint/model 时，自动回退 `heuristic-local`。

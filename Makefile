install:
	pnpm install


test:
	pnpm test


typecheck:
	pnpm run typecheck


inspect:
	pnpm run cli -- inspect fixtures/basic/UserList.vue

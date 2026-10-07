# Evolver Feature Matrix v0.3

| Capability | Status | Safety / Notes |
|---|---|---|
| Project scan | Implemented | Read-only |
| Project index | Implemented | `.hcbridge/index.json` |
| Vue SFC parse | Implemented | `@vue/compiler-sfc` |
| Template AST inspection | Implemented | `@vue/compiler-dom` |
| `<script setup>` state scan | Implemented | `ref/reactive/computed/props/emits` |
| Stable project-relative node ID | Implemented | Uses project-relative identity + structural evidence |
| Component import resolution | Implemented | Relative imports + TSConfig paths |
| Component metadata | Implemented | Registry + BlackBox |
| HCP projection | Implemented | Capability-oriented |
| Static prop update | Implemented | SAFE |
| Static prop add | Implemented | SAFE |
| Prop/directive removal | Implemented | SAFE |
| `:prop` update/add | Implemented | SAFE |
| `v-model` update/add | Implemented | SAFE |
| `@event` update/add | Implemented | SAFE |
| `v-if` update/add | Implemented | RISKY |
| Text update | Implemented | SAFE |
| Child insertion | Implemented | ASSISTED |
| Node deletion | Implemented | ASSISTED |
| Batch multi-file evolution | Implemented | Transactional restore |
| Precondition hash | Implemented | Mandatory |
| Patch overlap detection | Implemented | Mandatory |
| Source hash plan guard | Implemented | Mandatory |
| Reparse verification | Implemented | Mandatory |
| pnpm typecheck/build | Implemented | Optional strict gate |
| Inverse patch / rollback | Implemented | Journaled |
| Evolution history | Implemented | `.hcbridge/history` |
| Safety policy | Implemented | SAFE / ASSISTED / RISKY / REJECTED |
| Snapshot drift | Implemented | Read-only |
| Markdown report | Implemented | Read-only |
| Runtime trace | Protocol skeleton | Later phase |
| Platform adapter | Protocol skeleton | Later phase |
| Three-way merge | Planned | Not automatic |
| Runtime overlay | Planned | Only after no-op behavior is proven |
| Nuxt | Detection only | Not promised |
| JSX/render function | Unsupported | Opaque |
| Options API | Unsupported | Opaque |
| Arbitrary JS semantic lowering | Unsupported | Preserve / Opaque |

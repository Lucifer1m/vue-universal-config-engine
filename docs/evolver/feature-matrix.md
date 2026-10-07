# Evolver Feature Matrix

| Capability | Status | Safety mode |
|---|---|---|
| Project scan | Implemented | Read-only |
| Vue SFC parse | Implemented | Read-only |
| Template AST inspection | Implemented | Read-only |
| Component metadata | Implemented | Registry + BlackBox |
| HCP projection | Implemented | Read-only |
| Static prop update | Implemented | Minimal Patch |
| Static prop add | Implemented | Minimal Patch |
| Prop/directive removal | Implemented | Minimal Patch |
| `:prop` update/add | Implemented | Minimal Patch |
| `v-model` update | Implemented | Minimal Patch |
| `@event` update/add | Implemented | Minimal Patch |
| `v-if` update/add | Implemented | Minimal Patch |
| Text update | Implemented | Minimal Patch |
| Child insertion | Implemented | Raw template fragment |
| Node deletion | Implemented | Safe-reject on root/overlap |
| Batch multi-file evolution | Implemented | Transaction + restore |
| Precondition hash | Implemented | Mandatory |
| Patch overlap detection | Implemented | Mandatory |
| Reparse verification | Implemented | Mandatory |
| Project typecheck/build | Implemented | Optional; pnpm-first |
| Inverse patch / rollback | Implemented | Journaled |
| Snapshot | Implemented | Read-only |
| Snapshot drift status | Implemented | Read-only |
| Markdown report | Implemented | Read-only |
| Runtime trace protocol | Protocol skeleton | No automatic injection yet |
| Platform adapter | Protocol skeleton | Custom adapter required |
| Three-way merge | Not in MVP | Planned |
| Production runtime overlay | Not in MVP | Planned |
| Nuxt | Detected only | No conversion promise |
| JSX/render function | Not targeted | Opaque/unsupported |
| Options API | Not targeted | Opaque/unsupported |
| Arbitrary JS semantic lowering | Not targeted | Preserve / Opaque |

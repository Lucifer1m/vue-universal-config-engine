# Architecture

## MVP

`SFC Parser + TS Analyzer -> Source Model -> Semantic Graph -> HCP -> Patch Plan -> Minimal Patch -> Reparse -> Verify`

## 非目标

- 不建立新的低代码 Runtime
- 不建立新的 Canvas
- 不做自动三方 Merge
- 不把所有 JS/TS 转成 Action DSL
- 不承诺任意 Vue3 语法一次性覆盖

## 核心思想

源码是事实层，HCP 是能力层，平台 Schema 是投影层。未知组件/代码使用 BlackBox/Opaque 保留。

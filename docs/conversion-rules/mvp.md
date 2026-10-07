# MVP Conversion Rules

| Vue 能力 | 行为 |
|---|---|
| 静态 prop | Structured，可 Patch |
| v-model | Structured，首期只改表达式 |
| v-if/v-for | 识别并展示，不自动生成 Action |
| @click | 定位 handler，不解释函数内部 |
| ref/reactive/computed | 直写 script setup 可识别 |
| 未知自研组件 | BlackBox |
| eval / DOM hack / 动态 import | Opaque |

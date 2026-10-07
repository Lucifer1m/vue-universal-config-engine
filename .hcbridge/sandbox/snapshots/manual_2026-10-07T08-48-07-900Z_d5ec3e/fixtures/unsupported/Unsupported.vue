<template><div ref="el">不可猜测</div></template>
<script setup lang="ts">
const el = ref()
const code = "console.log('x')"
eval(code)
document.querySelector('#app')
const loader = await import(dynamicPath)
</script>

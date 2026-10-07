<template>
  <a-select v-model:value="value" :options="options" />
</template>

<script setup lang="ts">
import { ref } from 'vue'
const value = ref<string>()
const options = [{ label: '管理员', value: 'admin' }]
</script>

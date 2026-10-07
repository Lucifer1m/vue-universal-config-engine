<template>
  <div style="padding: 24px">
    <a-button type="primary" @click="toggle">切换</a-button>
    <a-input v-model:value="name" style="width: 240px; margin-left: 8px" placeholder="姓名" />
    <p v-if="show">你好，{{ name || '世界1' }}</p>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
const show = ref(true)
const name = ref('')
const toggle = () => { show.value = !show.value }
</script>

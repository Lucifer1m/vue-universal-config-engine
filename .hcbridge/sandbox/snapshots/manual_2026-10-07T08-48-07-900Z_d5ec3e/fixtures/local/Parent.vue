<template>
  <section class="page">
    <UserSelector />
    <a-button type="primary" @click="submit">提交</a-button>
  </section>
</template>

<script setup lang="ts">
import UserSelector from './UserSelector.vue'
const submit = () => undefined
</script>

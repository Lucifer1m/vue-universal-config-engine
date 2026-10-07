<template><div v-if="ready">{{ title }}</div></template>
<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
const state = reactive({ name: '' })
const ready = ref(true)
const title = computed(() => state.name || '空')
</script>

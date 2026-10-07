<template><div><component :is="current" /><div v-for="item in items" :key="item.id">{{ item.name }}</div></div></template>
<script setup lang="ts">
import { computed, ref } from 'vue'
const items = ref([{ id: 1, name: 'A' }])
const current = computed(() => items.value.length ? 'CompanyWidget' : 'EmptyState')
</script>

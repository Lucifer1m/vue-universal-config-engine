<template>
  <section>
    <a-button type="primary" @click="openCreate">新增</a-button>
    <a-table :loading="loading" :data-source="rows" />
    <a-modal :open="open" title="用户">编辑</a-modal>
  </section>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { AButton, AModal, ATable } from 'ant-design-vue'
const loading = ref(false)
const open = ref(false)
const rows = ref([])
const openCreate = () => { open.value = true }
</script>

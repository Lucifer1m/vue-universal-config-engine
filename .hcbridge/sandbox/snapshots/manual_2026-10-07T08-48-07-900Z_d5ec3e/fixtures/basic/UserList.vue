<template>
  <a-form layout="inline" :model="form">
    <a-input v-model:value="form.name" placeholder="姓名" />
    <a-button type="primary" @click="search">查询</a-button>
  </a-form>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { AButton, AForm, AInput } from 'ant-design-vue'

const form = reactive({ name: '' })
const loading = ref(false)

const search = async () => {
  loading.value = true
  loading.value = false
}
</script>

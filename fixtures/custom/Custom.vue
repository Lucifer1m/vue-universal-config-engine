<template><CompanyUserSelector v-model="value" :config="config" @change="onChange" /></template>
<script setup lang="ts">
import CompanyUserSelector from '@/components/CompanyUserSelector.vue'
import { ref } from 'vue'
const value = ref('')
const config = { multiple: true }
const onChange = (value: string) => console.log(value)
</script>

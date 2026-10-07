<template>
  <div class="selector">
    <slot name="prefix" />
    <button type="button" @click="emitChange">选择</button>
    <slot />
  </div>
</template>

<script setup lang="ts">
interface Props {
  modelValue?: string;
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  disabled: false,
});

const emit = defineEmits<{
  change: [value: string];
  (event: 'select', value: string): void;
}>();

const model = defineModel<string>();

defineExpose({
  focus: () => {},
  reset: () => {},
});

function emitChange() {
  emit('change', model.value ?? props.modelValue ?? '');
}
</script>

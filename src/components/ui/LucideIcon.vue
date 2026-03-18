<script setup lang="ts">
import { computed } from 'vue'
import * as lucideIcons from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  name: string
  size?: number
}>(), {
  size: 16,
})

function toPascalCase(str: string): string {
  return str
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
}

const iconComponent = computed(() => {
  const pascalName = toPascalCase(props.name)
  return (lucideIcons as Record<string, unknown>)[pascalName] ?? null
})
</script>

<template>
  <component :is="iconComponent" v-if="iconComponent" :size="size" />
</template>

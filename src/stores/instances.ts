import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { Instance } from '@/types/instance'

export const useInstancesStore = defineStore('instances', () => {
  const instances = ref<Instance[]>([])
  const activeInstanceId = ref<string | null>(null)

  const activeInstance = computed(() =>
    instances.value.find((i) => i.id === activeInstanceId.value) ?? null
  )

  const hasInstances = computed(() => instances.value.length > 0)

  async function hydrate(): Promise<void> {
    // TODO: Read from ~/.n8n-desk/instances/
  }

  function reset(): void {
    instances.value = []
    activeInstanceId.value = null
  }

  async function addInstance(_instance: Instance): Promise<void> {
    // TODO: Persist to disk
  }

  async function removeInstance(_id: string): Promise<void> {
    // TODO: Remove from disk
  }

  function setActive(id: string): void {
    activeInstanceId.value = id
  }

  return {
    instances,
    activeInstanceId,
    activeInstance,
    hasInstances,
    hydrate,
    reset,
    addInstance,
    removeInstance,
    setActive,
  }
})

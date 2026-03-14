import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export interface WorkflowSummary {
  id: string
  name: string
  active: boolean
  tags: string[]
  updatedAt: string
}

export const useWorkflowsStore = defineStore('workflows', () => {
  const workflows = ref<WorkflowSummary[]>([])
  const searchQuery = ref('')
  const isLoading = ref(false)

  const filteredWorkflows = computed(() => {
    const q = searchQuery.value.toLowerCase()
    if (!q) return workflows.value
    return workflows.value.filter(
      (w) => w.name.toLowerCase().includes(q) || w.tags.some((t) => t.toLowerCase().includes(q))
    )
  })

  async function hydrate(): Promise<void> {
    // TODO: Load cached workflow list
  }

  function reset(): void {
    workflows.value = []
    searchQuery.value = ''
    isLoading.value = false
  }

  async function search(_query: string): Promise<void> {
    // TODO: Search via MCP
  }

  function invalidateCache(): void {
    workflows.value = []
  }

  return {
    workflows,
    searchQuery,
    isLoading,
    filteredWorkflows,
    hydrate,
    reset,
    search,
    invalidateCache,
  }
})

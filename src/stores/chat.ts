import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { SessionMeta, SessionMessage } from '@/types/session'

export const useChatStore = defineStore('chat', () => {
  const sessions = ref<SessionMeta[]>([])
  const activeSessionId = ref<string | null>(null)
  const messages = ref<SessionMessage[]>([])

  const activeSession = computed(() =>
    sessions.value.find((s) => s.id === activeSessionId.value) ?? null
  )

  const sortedSessions = computed(() =>
    [...sessions.value].sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  )

  async function hydrate(): Promise<void> {
    // TODO: Read session index and messages from JSONL
  }

  function reset(): void {
    sessions.value = []
    activeSessionId.value = null
    messages.value = []
  }

  async function createSession(_title: string): Promise<string> {
    // TODO: Create session file and index entry
    return ''
  }

  async function deleteSession(_id: string): Promise<void> {
    // TODO: Move to archive
  }

  async function appendMessage(_message: SessionMessage): Promise<void> {
    // TODO: Append to JSONL file
  }

  return {
    sessions,
    activeSessionId,
    messages,
    activeSession,
    sortedSessions,
    hydrate,
    reset,
    createSession,
    deleteSession,
    appendMessage,
  }
})

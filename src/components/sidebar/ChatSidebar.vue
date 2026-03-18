<script setup lang="ts">
import {
  IonSearchbar,
} from '@ionic/vue'
import { Plus, Search } from 'lucide-vue-next'
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import SessionList from './SessionList.vue'
import { useChatStore } from '@/stores/chat'
import { useChatHub } from '@/composables/useChatHub'

const { t } = useI18n()
const chatStore = useChatStore()
const chatHub = useChatHub()
const searchQuery = ref('')
const searchVisible = ref(false)

function newChat() {
  chatStore.preparePendingChat()
}

onMounted(() => {
  chatHub.connect()
  chatHub.loadAgents()
  // Sync local sessions with server to pick up generated titles
  chatStore.syncSessionsFromServer()
})

function selectSession(sessionId: string) {
  chatStore.switchSession(sessionId)
}

async function renameSession(sessionId: string, newTitle: string) {
  await chatStore.renameSession(sessionId, newTitle)
}

async function deleteSession(sessionId: string) {
  await chatStore.deleteSession(sessionId)
}
</script>

<template>
  <div class="chat-sidebar">
    <!-- Action Items -->
    <div class="sidebar-actions">
      <button class="sidebar-action-btn" @click="newChat">
        <Plus :size="16" />
        <span>{{ t('sidebar.newChat') }}</span>
      </button>
      <button class="sidebar-action-btn" @click="searchVisible = !searchVisible">
        <Search :size="16" />
        <span>{{ t('sidebar.searchChats').replace('...', '') }}</span>
      </button>
    </div>

    <!-- Search (toggleable) -->
    <div v-if="searchVisible" class="sidebar-section">
      <ion-searchbar
        v-model="searchQuery"
        :placeholder="t('sidebar.searchChats')"
        :debounce="300"
      />
    </div>

    <!-- Session List -->
    <SessionList
      :sessions="chatStore.sortedSessions"
      :active-session-id="chatStore.activeSessionId"
      :search-query="searchQuery"
      @select="selectSession"
      @rename="renameSession"
      @delete="deleteSession"
    />
  </div>
</template>

<style scoped lang="scss">
.chat-sidebar {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.sidebar-section {
  padding: var(--spacing--2xs) var(--spacing--xs);
}

.sidebar-actions {
  display: flex;
  flex-direction: column;
  padding: var(--spacing--xs) var(--spacing--xs) 0;
}

.sidebar-action-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--color--text--tint-1);
  font-size: 13px;
  font-weight: 400;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s ease, color 0.12s ease;

  &:hover {
    background: var(--n8n-desk--surface-raised-bg);
    color: var(--color--text);
  }
}

ion-searchbar {
  --background: var(--n8n-desk--surface-bg);
  --border-radius: var(--radius--xs);
  padding: 0;
}
</style>

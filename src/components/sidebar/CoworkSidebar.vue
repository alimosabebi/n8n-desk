<script setup lang="ts">
import { IonSearchbar } from '@ionic/vue'
import { Plus, Search } from 'lucide-vue-next'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SessionList from './SessionList.vue'
import { mockCoworkSessions } from '@/mocks/sidebar'

const { t } = useI18n()
const searchQuery = ref('')
const searchVisible = ref(false)
const activeSessionId = ref<string | null>(null)

function newTask() {
  // TODO: create new cowork session
}

function selectSession(sessionId: string) {
  activeSessionId.value = sessionId
}

function renameSession(_sessionId: string, _newTitle: string) {
  // TODO: wire to cowork store when implemented
}

function deleteSession(_sessionId: string) {
  // TODO: wire to cowork store when implemented
}
</script>

<template>
  <div class="cowork-sidebar">
    <!-- Action Items -->
    <div class="sidebar-actions">
      <button class="sidebar-action-btn" @click="newTask">
        <Plus :size="16" />
        <span>{{ t('sidebar.newTask') }}</span>
      </button>
      <button class="sidebar-action-btn" @click="searchVisible = !searchVisible">
        <Search :size="16" />
        <span>{{ t('sidebar.searchTasks').replace('...', '') }}</span>
      </button>
    </div>

    <!-- Search (toggleable) -->
    <div v-if="searchVisible" class="sidebar-section">
      <ion-searchbar
        v-model="searchQuery"
        :placeholder="t('sidebar.searchTasks')"
        :debounce="300"
      />
    </div>

    <!-- Session List -->
    <SessionList
      :sessions="mockCoworkSessions"
      :active-session-id="activeSessionId"
      :search-query="searchQuery"
      @select="selectSession"
      @rename="renameSession"
      @delete="deleteSession"
    />
  </div>
</template>

<style scoped lang="scss">
.cowork-sidebar {
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

<template>
  <div :class="$style.container">
    <ConnectionIndicator />

    <!-- Model selector header -->
    <div v-if="hasChatContext" :class="$style.header">
      <button :class="$style.modelSelector" @click="pickerOpen = true">
        <div :class="$style.modelIcon">
          <LucideIcon
            v-if="selectedDto?.icon?.type === 'icon'"
            :name="selectedDto.icon.value"
            :size="16"
          />
          <span v-else-if="selectedDto">{{ selectedDto.name.charAt(0).toUpperCase() }}</span>
        </div>
        <span :class="$style.modelName">{{ displayName }}</span>
        <ChevronDown :size="14" :class="$style.chevron" />
      </button>
    </div>

    <template v-if="hasChatContext">
      <ChatMessageList
        v-if="activeSessionId"
        :session-id="activeSessionId"
        :class="$style.messageList"
        @edit-message="handleEditMessage"
        @regenerate-message="handleRegenerateMessage"
      />
      <div v-else :class="$style.messageList" />

      <ChatInput
        :is-streaming="isStreaming"
        :is-offline="!isConnected"
        :error="apiError"
        @send="handleSend"
        @stop="handleStop"
        @dismiss-error="chatHub.clearError()"
      />
    </template>

    <div v-else :class="$style.emptyState">
      <div :class="$style.emptyIcon"><MessageSquare :size="32" /></div>
      <h3 :class="$style.emptyTitle">Start a conversation</h3>
      <p :class="$style.emptyDescription">
        Select an agent and send a message to get started.
      </p>
    </div>

    <!-- Agent/Model picker modal -->
    <AgentPicker
      v-model:is-open="pickerOpen"
      :agents="chatStore.agents"
      :selected-model="chatStore.selectedModel"
      @select="handleModelSelect"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { MessageSquare, ChevronDown } from 'lucide-vue-next'
import LucideIcon from '@/components/ui/LucideIcon.vue'
import ChatMessageList from './ChatMessageList.vue'
import ChatInput from './ChatInput.vue'
import ConnectionIndicator from './ConnectionIndicator.vue'
import AgentPicker from './AgentPicker.vue'
import { useChatHub } from '@/composables/useChatHub'
import { useChatStore } from '@/stores/chat'
import type { ChatModelDto, ChatHubConversationModel } from '@/types/chathub'

const chatStore = useChatStore()
const chatHub = useChatHub()
const pickerOpen = ref(false)

const activeSessionId = computed(() => chatStore.activeSessionId)
const hasChatContext = computed(() => !!activeSessionId.value || chatStore.pendingNewChat)
const isStreaming = computed(() => chatStore.isStreaming)
const isConnected = computed(() => chatHub.isConnected.value)
const apiError = computed(() => chatHub.error.value)

const selectedDto = computed(() => chatStore.selectedModelDto)
const displayName = computed(() => {
  const dto = selectedDto.value
  if (dto) return dto.name
  const model = chatStore.selectedModel
  if (model && 'model' in model) return model.model
  return 'Select model'
})

function getCurrentModel(): ChatHubConversationModel {
  // Use the store's selected model
  if (chatStore.selectedModel) {
    return chatStore.selectedModel
  }
  // If there's a pending agent (not yet sent first message), use its model
  const pending = chatStore.pendingAgent
  if (pending) {
    return pending.model
  }
  const session = chatStore.activeSession
  // If session has an agentId, use the custom-agent model
  if (session?.agentId) {
    return { provider: 'custom-agent', agentId: session.agentId }
  }
  // Fallback to the first available agent's model definition
  const firstAgent = chatStore.agents[0]
  if (firstAgent) {
    return firstAgent.model
  }
  // Last resort fallback
  return { provider: 'openai', model: 'gpt-4' }
}

function handleModelSelect(agent: ChatModelDto) {
  chatStore.selectModel(agent.model)
  // Switching model/agent always starts a new chat session
  chatStore.preparePendingChat()
}

async function handleSend(message: string): Promise<void> {
  const model = getCurrentModel()
  await chatHub.sendMessage(message, model)
}

async function handleStop(): Promise<void> {
  await chatHub.stopGeneration()
}

async function handleEditMessage(messageId: string): Promise<void> {
  const sessionId = activeSessionId.value
  if (!sessionId) return

  const messages = chatStore.messagesBySession.get(sessionId) ?? []
  const msg = messages.find((m) => m.id === messageId)
  if (!msg || msg.role !== 'user') return

  const model = getCurrentModel()
  await chatHub.editMessage(sessionId, messageId, msg.content, model)
}

async function handleRegenerateMessage(messageId: string): Promise<void> {
  const sessionId = activeSessionId.value
  if (!sessionId) return

  const model = getCurrentModel()
  await chatHub.regenerateMessage(sessionId, messageId, model)
}
</script>

<style lang="scss" module>
.container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--n8n-desk--content-bg, var(--color--background));
}

.header {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid var(--color--border--base, rgba(255, 255, 255, 0.06));
  flex-shrink: 0;
}

.modelSelector {
  display: flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  border: none;
  color: var(--color--text);
  font-size: var(--font-size--sm, 14px);
  font-weight: var(--font-weight--semi-bold, 600);
  cursor: pointer;
  padding: 6px 10px;
  border-radius: var(--radius--2xs, 6px);
  transition: background 0.12s ease;

  &:hover {
    background: var(--n8n-desk--surface-raised-bg);
  }
}

.modelIcon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  color: var(--color--text--tint-1);
  font-size: 11px;
  font-weight: var(--font-weight--semi-bold, 600);
  flex-shrink: 0;
}

.modelName {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 250px;
}

.chevron {
  color: var(--color--text--tint-1);
  flex-shrink: 0;
}

.messageList {
  flex: 1;
  min-height: 0;
}

.emptyState {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-2xl, 32px);
  text-align: center;
}

.emptyIcon {
  font-size: 48px;
  margin-bottom: var(--spacing-m, 16px);
}

.emptyTitle {
  margin: 0 0 var(--spacing-xs, 8px);
  font-size: var(--font-size-l, 18px);
  font-weight: var(--font-weight-bold, 600);
  color: var(--color--text-dark, #333);
}

.emptyDescription {
  margin: 0;
  font-size: var(--font-size-s, 14px);
  color: var(--color--text-light, #999);
  max-width: 300px;
}
</style>

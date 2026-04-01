<template>
  <div :class="$style.container">
    <div v-if="error" :class="$style.errorBar">
      <span :class="$style.errorText">{{ error }}</span>
      <button
        :class="$style.errorClose"
        type="button"
        aria-label="Dismiss error"
        @click="emit('dismissError')"
      >
        &times;
      </button>
    </div>
    <div :class="[$style.inputWrapper, error && $style.inputWrapperWithError]">
      <div v-if="attachedFolders.length > 0" :class="$style.folderChips">
        <span
          v-for="folder in attachedFolders"
          :key="folder.path"
          :class="$style.folderChip"
        >
          <span :class="$style.folderChipLabel">{{ folder.label }}</span>
          <button
            :class="$style.folderChipRemove"
            type="button"
            :aria-label="`Remove folder ${folder.label}`"
            @click="removeFolder(folder.path)"
          >
            <X :size="12" />
          </button>
        </span>
      </div>
      <div :class="$style.inputRow">
        <textarea
          ref="textareaRef"
          v-model="message"
          :class="$style.textarea"
          :placeholder="placeholderText"
          :disabled="isDisabled"
          rows="1"
          @input="autoExpand"
          @keydown="handleKeydown"
        />
        <button
          v-if="showFolderPicker"
          :class="[$style.actionButton, $style.folderButton]"
          type="button"
          :disabled="isDisabled"
          aria-label="Attach folder"
          @click="handleOpenFolder"
        >
          <FolderPlus :size="16" />
        </button>
        <button
          v-if="isStreaming"
          :class="[$style.actionButton, $style.stopButton]"
          type="button"
          aria-label="Stop generation"
          @click="emit('stop')"
        >
          <span :class="$style.stopIcon" />
        </button>
        <button
          v-else
          :class="[$style.actionButton, $style.sendButton]"
          type="button"
          :disabled="!canSend"
          aria-label="Send message"
          @click="handleSend"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 13L13 8L3 3V7L9 8L3 9V13Z" fill="currentColor" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { FolderPlus, X } from 'lucide-vue-next'
import type { AttachedFolder } from '@/types/session'

const props = defineProps<{
  isStreaming?: boolean
  isOffline?: boolean
  disabled?: boolean
  error?: string | null
  showFolderPicker?: boolean
}>()

const emit = defineEmits<{
  send: [message: string, attachedFolders: AttachedFolder[]]
  stop: []
  dismissError: []
}>()

const message = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const attachedFolders = ref<AttachedFolder[]>([])

const isDisabled = computed(() => props.isOffline || props.disabled)
const canSend = computed(() => message.value.trim().length > 0 && !isDisabled.value)

const placeholderText = computed(() => {
  if (props.isOffline) return 'Reconnect to continue…'
  return 'Type a message…'
})

function autoExpand() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`
}

function resetHeight() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

function handleSend() {
  if (!canSend.value) return
  const text = message.value.trim()
  message.value = ''
  nextTick(() => resetHeight())
  emit('send', text, attachedFolders.value)
}

async function handleOpenFolder() {
  const folderPath = await window.n8nDesk?.dialog.openFolder()
  if (!folderPath) return

  // Don't add duplicates
  if (attachedFolders.value.some((f) => f.path === folderPath)) return

  const label = folderPath.split(/[\\/]/).pop() ?? folderPath
  attachedFolders.value.push({ path: folderPath, label, mode: 'rw' })
}

function removeFolder(folderPath: string) {
  attachedFolders.value = attachedFolders.value.filter((f) => f.path !== folderPath)
}

watch(() => props.isStreaming, (streaming, prev) => {
  if (prev && !streaming) {
    nextTick(() => textareaRef.value?.focus())
  }
})
</script>

<style lang="scss" module>
.container {
  padding: 8px 16px 16px;
  background: var(--n8n-desk--content-bg);
}

.errorBar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 14px;
  background: var(--color--danger);
  color: #fff;
  font-size: 12px;
  line-height: 1.4;
  border-radius: 12px 12px 0 0;
  border: 1px solid var(--color--danger);
  border-bottom: none;
}

.errorText {
  flex: 1;
  min-width: 0;
}

.errorClose {
  flex-shrink: 0;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.8);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;

  &:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.15);
  }
}

.inputWrapper {
  display: flex;
  flex-direction: column;
  gap: 0;
  background: var(--n8n-desk--surface-bg);
  border: 1px solid var(--color--border--base, #ccc);
  border-radius: 12px;
  padding: 8px 8px 8px 14px;
  transition: border-color 0.15s;

  &:focus-within {
    border-color: var(--color--primary, #ff6d5a);
  }
}

.folderChips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding-bottom: 6px;
}

.folderChip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px 2px 8px;
  background: var(--n8n-desk--surface-raised-bg);
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--color--text--dark, inherit);
  max-width: 200px;
}

.folderChipLabel {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folderChipRemove {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--color--text--light, #999);
  cursor: pointer;
  transition: color 0.15s, background-color 0.15s;

  &:hover {
    color: var(--color--text--dark, inherit);
    background: rgba(0, 0, 0, 0.08);
  }
}

.inputRow {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.inputWrapperWithError {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
  border-top-color: var(--color--danger);
}

.textarea {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--color--text--dark, inherit);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.5;
  resize: none;
  max-height: 200px;
  padding: 2px 0;

  &::placeholder {
    color: var(--color--text--light, #999);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
}

.actionButton {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s, background-color 0.15s;
}

.sendButton {
  background: var(--color--primary, #ff6d5a);
  color: #fff;

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  &:not(:disabled):hover {
    opacity: 0.85;
  }
}

.stopButton {
  background: var(--color--danger, #d32f2f);
  color: #fff;

  &:hover {
    opacity: 0.85;
  }
}

.stopIcon {
  display: block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: currentColor;
}

.folderButton {
  background: transparent;
  color: var(--color--text--light, #999);

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  &:not(:disabled):hover {
    color: var(--color--text--dark, inherit);
    background: var(--n8n-desk--surface-raised-bg);
  }
}
</style>

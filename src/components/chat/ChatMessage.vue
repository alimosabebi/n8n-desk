<script setup lang="ts">
import { computed, ref } from 'vue'
import { Copy, Check } from 'lucide-vue-next'
import type { SessionMessage } from '@/types/session'
import type { ChatMessageContentChunk } from '@/types/chathub'
import MarkdownRenderer from './MarkdownRenderer.vue'
import BlinkingCursor from './BlinkingCursor.vue'
import ArtifactBlock from './ArtifactBlock.vue'

const props = defineProps<{
  message: SessionMessage
  isStreaming?: boolean
}>()

const emit = defineEmits<{
  edit: [messageId: string]
  regenerate: [messageId: string]
}>()

const isUser = computed(() => props.message.role === 'user')
const isAssistant = computed(() => props.message.role === 'assistant')
const isSystem = computed(() => props.message.role === 'system')
const hasError = computed(() => !!props.message.meta?.error)

/**
 * Parse content chunks from message meta, falling back to a single text chunk.
 */
const contentChunks = computed<ChatMessageContentChunk[]>(() => {
  const meta = props.message.meta
  if (meta?.contentChunks && Array.isArray(meta.contentChunks)) {
    return meta.contentChunks as ChatMessageContentChunk[]
  }
  return [{ type: 'text', content: props.message.content }]
})

/** Visible (non-hidden) chunks */
const visibleChunks = computed(() =>
  contentChunks.value.filter((c) => c.type !== 'hidden')
)

/** Whether the message has any artifact chunks */
const hasArtifacts = computed(() =>
  contentChunks.value.some(
    (c) => c.type === 'artifact-create' || c.type === 'artifact-edit'
  )
)

const formattedTime = computed(() => {
  try {
    const date = new Date(props.message.ts)
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
})

/** Plain text content for copying (strips markdown for assistant, raw for user) */
const copyableText = computed(() => {
  if (isUser.value) return props.message.content
  // For assistant messages, join all text chunks
  return contentChunks.value
    .filter((c) => c.type === 'text' || c.type === 'with-buttons')
    .map((c) => c.content)
    .join('\n\n')
})

const justCopied = ref(false)

async function copyMessage(): Promise<void> {
  try {
    await navigator.clipboard.writeText(copyableText.value)
    justCopied.value = true
    setTimeout(() => { justCopied.value = false }, 1500)
  } catch {
    // Fallback for older browsers / Electron
    const textarea = document.createElement('textarea')
    textarea.value = copyableText.value
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    justCopied.value = true
    setTimeout(() => { justCopied.value = false }, 1500)
  }
}
</script>

<template>
  <div
    :class="[
      $style.message,
      isUser && $style.user,
      isAssistant && $style.assistant,
      isSystem && $style.system,
    ]"
  >
    <!-- User message: plain text -->
    <div v-if="isUser" :class="$style.bubble">
      <p :class="$style.textContent">{{ message.content }}</p>
    </div>

    <!-- Assistant message: markdown with content chunks -->
    <div v-else-if="isAssistant" :class="$style.bubble">
      <template v-for="(chunk, idx) in visibleChunks" :key="idx">
        <!-- Text chunk: render as markdown -->
        <MarkdownRenderer
          v-if="chunk.type === 'text'"
          :content="chunk.content"
        />

        <ArtifactBlock
          v-else-if="chunk.type === 'artifact-create' || chunk.type === 'artifact-edit'"
          :chunk="chunk"
        />

        <!-- Button chunk -->
        <div
          v-else-if="chunk.type === 'with-buttons'"
          :class="$style.buttonChunk"
        >
          <MarkdownRenderer :content="chunk.content" />
          <div :class="$style.buttons">
            <a
              v-for="btn in chunk.buttons"
              :key="btn.link"
              :href="btn.link"
              target="_blank"
              rel="noopener noreferrer"
              :class="[$style.button, btn.type === 'primary' && $style.buttonPrimary]"
            >
              {{ btn.text }}
            </a>
          </div>
        </div>
      </template>

      <!-- Streaming cursor -->
      <BlinkingCursor v-if="isStreaming" />

      <!-- Stream error -->
      <div v-if="hasError" class="n8n-callout n8n-callout--danger" :class="$style.errorBanner">
        {{ message.meta?.error }}
      </div>
    </div>

    <!-- System message -->
    <div v-else-if="isSystem" :class="$style.systemBubble">
      <p :class="$style.textContent">{{ message.content }}</p>
    </div>

    <!-- Timestamp + actions -->
    <div :class="$style.meta">
      <span v-if="formattedTime" :class="$style.timestamp">{{ formattedTime }}</span>
      <div :class="[$style.actions, justCopied && $style.actionsVisible]">
        <button
          v-if="!isSystem && !isStreaming"
          :class="[$style.actionBtn, justCopied && $style.actionBtnSuccess]"
          :title="justCopied ? 'Copied!' : 'Copy message'"
          @click="copyMessage"
        >
          <Check v-if="justCopied" :size="14" />
          <Copy v-else :size="14" />
        </button>
        <button
          v-if="isUser"
          :class="$style.actionBtn"
          title="Edit message"
          @click="emit('edit', message.id)"
        >
          ✎
        </button>
        <button
          v-if="isAssistant && !isStreaming"
          :class="$style.actionBtn"
          title="Regenerate response"
          @click="emit('regenerate', message.id)"
        >
          ↻
        </button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
.message {
  display: flex;
  flex-direction: column;
  max-width: 85%;
  margin-bottom: var(--spacing--xs);

  &:hover .actions {
    opacity: 1;
  }
}

.user {
  align-self: flex-end;
  align-items: flex-end;
}

.assistant {
  align-self: flex-start;
  align-items: flex-start;
}

.system {
  align-self: center;
  align-items: center;
}

.bubble {
  padding: var(--spacing--xs) var(--spacing--sm);
  border-radius: var(--radius--md);
  line-height: 1.5;
  font-size: var(--font-size--s);

  .user & {
    background: var(--color--primary);
    color: var(--color--primary--text, #fff);
    border-bottom-right-radius: var(--radius--xs);
  }

  .assistant & {
    background: var(--n8n-desk--surface-bg);
    color: var(--color--text);
    border-bottom-left-radius: var(--radius--xs);
  }
}

.systemBubble {
  padding: var(--spacing--3xs) var(--spacing--xs);
  font-size: var(--font-size--2xs);
  color: var(--color--text--light);
  font-style: italic;
}

.textContent {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.artifactPlaceholder {
  margin: var(--spacing--xs) 0;
  padding: var(--spacing--xs);
  background: var(--n8n-desk--surface-raised-bg);
  border-radius: var(--radius--sm);
  border: 1px solid var(--color--foreground--shade-3);
}

.artifactLabel {
  font-weight: var(--font-weight--semi-bold);
  font-size: var(--font-size--2xs);
}

.artifactLoading {
  font-size: var(--font-size--3xs);
  color: var(--color--text--light);
  margin-top: var(--spacing--4xs);
}

.buttonChunk {
  margin-top: var(--spacing--xs);
}

.buttons {
  display: flex;
  gap: var(--spacing--xs);
  margin-top: var(--spacing--xs);
  flex-wrap: wrap;
}

.button {
  display: inline-block;
  padding: var(--spacing--3xs) var(--spacing--xs);
  border-radius: var(--radius--sm);
  font-size: var(--font-size--2xs);
  text-decoration: none;
  color: var(--color--text);
  background: var(--n8n-desk--surface-raised-bg);
  border: 1px solid var(--color--foreground--shade-3);
  cursor: pointer;

  &:hover {
    background: var(--color--foreground--shade-1);
  }
}

.buttonPrimary {
  background: var(--color--primary);
  color: var(--color--primary--text, #fff);
  border-color: var(--color--primary);

  &:hover {
    background: var(--color--primary--shade-1);
  }
}

.errorBanner {
  margin-top: var(--spacing--xs);
}

.meta {
  display: flex;
  align-items: center;
  gap: var(--spacing--3xs);
  margin-top: var(--spacing--4xs);
  min-height: 20px;
}

.timestamp {
  font-size: var(--font-size--3xs);
  color: var(--color--text--light);
}

.actions {
  display: flex;
  gap: var(--spacing--4xs);
  opacity: 0;
  transition: opacity 0.15s ease;
}

.actionsVisible {
  opacity: 1;
}

.actionBtn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--font-size--xs);
  color: var(--color--text--light);
  padding: 2px 4px;
  border-radius: var(--radius--xs);
  line-height: 1;
  display: inline-flex;
  align-items: center;

  &:hover {
    color: var(--color--text);
    background: var(--n8n-desk--surface-raised-bg);
  }
}

.actionBtnSuccess {
  color: var(--color--success);
  opacity: 1 !important;
}
</style>

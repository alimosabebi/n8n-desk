<script setup lang="ts">
import { computed, ref } from 'vue'
import { IonIcon } from '@ionic/vue'
import { chevronDownOutline, chevronForwardOutline } from 'ionicons/icons'
import { FilePlus, Pencil } from 'lucide-vue-next'
import { renderMarkdown } from '@/utils/markdown'
import { n8nHtml } from '@/directives/n8n-html'
import type { ChatArtifactCreateCommand, ChatArtifactEditCommand } from '@/types/chathub'

const vN8nHtml = n8nHtml

type ArtifactChunk =
  | {
      type: 'artifact-create'
      content: string
      command: ChatArtifactCreateCommand
      isIncomplete: boolean
    }
  | {
      type: 'artifact-edit'
      content: string
      command: ChatArtifactEditCommand
      isIncomplete: boolean
    }

const props = defineProps<{
  chunk: ArtifactChunk
}>()

const isExpanded = ref(false)

const isCreate = computed(() => props.chunk.type === 'artifact-create')
const title = computed(() => props.chunk.command.title || 'Untitled')
const artifactType = computed(() =>
  isCreate.value ? (props.chunk.command as ChatArtifactCreateCommand).type || 'text' : 'edit',
)

const renderedContent = computed(() => {
  if (props.chunk.isIncomplete) return ''

  if (isCreate.value) {
    const cmd = props.chunk.command as ChatArtifactCreateCommand
    const lang = inferLanguage(cmd.type)
    if (lang) {
      return renderMarkdown(`\`\`\`${lang}\n${cmd.content}\n\`\`\``)
    }
    return renderMarkdown(cmd.content)
  }

  // Edit: show diff-style view
  const cmd = props.chunk.command as ChatArtifactEditCommand
  const parts: string[] = []
  if (cmd.oldString) {
    parts.push(`\`\`\`diff\n- ${cmd.oldString.split('\n').join('\n- ')}\n+ ${cmd.newString.split('\n').join('\n+ ')}\n\`\`\``)
  } else {
    parts.push(`\`\`\`\n${cmd.newString}\n\`\`\``)
  }
  if (cmd.replaceAll) {
    parts.push('*(replace all occurrences)*')
  }
  return renderMarkdown(parts.join('\n\n'))
})

function inferLanguage(type: string): string {
  const map: Record<string, string> = {
    'text/javascript': 'javascript',
    'text/typescript': 'typescript',
    'text/html': 'html',
    'text/css': 'css',
    'text/python': 'python',
    'application/json': 'json',
    'text/markdown': '',
  }
  if (map[type] !== undefined) return map[type]
  // Try using type directly as language hint
  if (/^[a-z]+$/.test(type)) return type
  return ''
}

function toggleExpanded() {
  if (!props.chunk.isIncomplete) {
    isExpanded.value = !isExpanded.value
  }
}
</script>

<template>
  <div :class="[$style.artifact, { [$style.expanded]: isExpanded }]">
    <button :class="$style.header" type="button" @click="toggleExpanded">
      <ion-icon
        :icon="isExpanded ? chevronDownOutline : chevronForwardOutline"
        :class="$style.chevron"
      />
      <span :class="$style.icon"><FilePlus v-if="isCreate" :size="14" /><Pencil v-else :size="14" /></span>
      <span :class="$style.title">{{ title }}</span>
      <span :class="$style.badge">{{ artifactType }}</span>
      <span v-if="chunk.isIncomplete" :class="$style.loading">Generating…</span>
    </button>

    <div v-if="chunk.isIncomplete && !isExpanded" :class="$style.skeleton">
      <div :class="$style.skeletonLine" />
      <div :class="[$style.skeletonLine, $style.skeletonShort]" />
      <div :class="$style.skeletonLine" />
    </div>

    <div v-if="isExpanded && !chunk.isIncomplete" :class="$style.body">
      <div v-n8n-html="renderedContent" :class="$style.content" />
    </div>
  </div>
</template>

<style lang="scss" module>
.artifact {
  margin: var(--spacing--xs) 0;
  border-radius: var(--radius--sm);
  border: 1px solid var(--color--foreground--shade-3);
  background: var(--n8n-desk--surface-raised-bg);
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  gap: var(--spacing--3xs);
  width: 100%;
  padding: var(--spacing--xs) var(--spacing--s);
  border: none;
  background: none;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: var(--color--text);

  &:hover {
    background: var(--n8n-desk--surface-bg);
  }
}

.chevron {
  font-size: 14px;
  color: var(--color--text--light);
  flex-shrink: 0;
}

.icon {
  flex-shrink: 0;
}

.title {
  font-weight: var(--font-weight--semi-bold);
  font-size: var(--font-size--2xs);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge {
  font-size: var(--font-size--3xs);
  padding: 1px 6px;
  border-radius: var(--radius--xs);
  background: var(--color--foreground--shade-3);
  color: var(--color--text--light);
  flex-shrink: 0;
}

.loading {
  font-size: var(--font-size--3xs);
  color: var(--color--text--light);
  animation: pulse 1.5s ease-in-out infinite;
}

.skeleton {
  padding: var(--spacing--xs) var(--spacing--s);
  display: flex;
  flex-direction: column;
  gap: var(--spacing--3xs);
}

.skeletonLine {
  height: 12px;
  border-radius: var(--radius--xs);
  background: var(--n8n-desk--surface-bg);
  animation: pulse 1.5s ease-in-out infinite;
}

.skeletonShort {
  width: 60%;
}

.body {
  padding: 0 var(--spacing--s) var(--spacing--xs);
}

.content {
  font-size: var(--font-size--2xs);
  line-height: 1.5;
  overflow-x: auto;

  :global(pre.hljs) {
    border-radius: var(--radius--xs);
    padding: var(--spacing--xs);
    margin: 0;
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
</style>

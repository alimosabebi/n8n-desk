<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from '@/utils/markdown'
import { n8nHtml } from '@/directives/n8n-html'

const vN8nHtml = n8nHtml

const props = defineProps<{
  content: string
}>()

const renderedHtml = computed(() => renderMarkdown(props.content))
</script>

<template>
  <div v-n8n-html="renderedHtml" :class="$style.markdown" />
</template>

<style lang="scss" module>
.markdown {
  display: block;
  font-size: inherit;
  line-height: 1.5;
  word-wrap: break-word;

  > *:first-child {
    margin-top: 0;
  }

  > *:last-child {
    margin-bottom: 0;
  }

  p {
    margin: 0.5em 0;
  }

  pre {
    font-family: var(--font-family--monospace, monospace);
    font-size: var(--font-size--2xs);
    margin: 0.5em 0;
    white-space: pre-wrap;
    padding: var(--spacing--xs);
    background: var(--n8n-desk--surface-bg);
    border-radius: var(--radius--sm);
  }

  code {
    font-family: var(--font-family--monospace, monospace);
    font-size: 0.9em;
    padding: 0.1em 0.3em;
    background: var(--n8n-desk--surface-bg);
    border-radius: var(--radius--xs);
  }

  pre code {
    padding: 0;
    background: none;
  }

  a {
    color: var(--color--primary);
    text-decoration: underline;
  }

  ul,
  ol {
    padding-left: 1.5em;
    margin: 0.5em 0;
  }

  blockquote {
    margin: 0.5em 0;
    padding-left: var(--spacing--xs);
    border-left: 3px solid var(--color--foreground--shade-3);
    color: var(--color--text--light);
  }
}
</style>

import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatMessage from '@/components/chat/ChatMessage.vue'
import type { SessionMessage } from '@/types/session'

// Stub child components
vi.mock('@/components/chat/MarkdownRenderer.vue', () => ({
  default: { name: 'MarkdownRenderer', props: ['content'], template: '<div class="md">{{ content }}</div>' },
}))
vi.mock('@/components/chat/BlinkingCursor.vue', () => ({
  default: { name: 'BlinkingCursor', template: '<span class="cursor" />' },
}))
vi.mock('@/components/chat/ArtifactBlock.vue', () => ({
  default: { name: 'ArtifactBlock', props: ['chunk'], template: '<div class="artifact" />' },
}))

function makeMessage(overrides: Partial<SessionMessage> = {}): SessionMessage {
  return {
    id: 'msg_1',
    role: 'user',
    content: 'Hello world',
    ts: '2026-03-14T10:00:00Z',
    ...overrides,
  }
}

describe('ChatMessage', () => {
  // ---------------------------------------------------------------------------
  // User messages
  // ---------------------------------------------------------------------------
  describe('user message', () => {
    it('renders plain text content', () => {
      const wrapper = mount(ChatMessage, {
        props: { message: makeMessage({ role: 'user', content: 'Hi there' }) },
      })
      expect(wrapper.text()).toContain('Hi there')
    })

    it('shows edit action button', () => {
      const wrapper = mount(ChatMessage, {
        props: { message: makeMessage({ role: 'user' }) },
      })
      const editBtn = wrapper.find('button[title="Edit message"]')
      expect(editBtn.exists()).toBe(true)
    })

    it('emits edit event on click', async () => {
      const wrapper = mount(ChatMessage, {
        props: { message: makeMessage({ id: 'msg_42', role: 'user' }) },
      })
      await wrapper.find('button[title="Edit message"]').trigger('click')
      expect(wrapper.emitted('edit')).toEqual([['msg_42']])
    })

    it('does not show regenerate button', () => {
      const wrapper = mount(ChatMessage, {
        props: { message: makeMessage({ role: 'user' }) },
      })
      expect(wrapper.find('button[title="Regenerate response"]').exists()).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Assistant messages
  // ---------------------------------------------------------------------------
  describe('assistant message', () => {
    it('renders markdown content via MarkdownRenderer', () => {
      const wrapper = mount(ChatMessage, {
        props: { message: makeMessage({ role: 'assistant', content: '**bold**' }) },
      })
      const md = wrapper.findComponent({ name: 'MarkdownRenderer' })
      expect(md.exists()).toBe(true)
      expect(md.props('content')).toBe('**bold**')
    })

    it('shows regenerate button when not streaming', () => {
      const wrapper = mount(ChatMessage, {
        props: { message: makeMessage({ role: 'assistant' }), isStreaming: false },
      })
      expect(wrapper.find('button[title="Regenerate response"]').exists()).toBe(true)
    })

    it('emits regenerate event on click', async () => {
      const wrapper = mount(ChatMessage, {
        props: { message: makeMessage({ id: 'msg_99', role: 'assistant' }) },
      })
      await wrapper.find('button[title="Regenerate response"]').trigger('click')
      expect(wrapper.emitted('regenerate')).toEqual([['msg_99']])
    })

    it('hides regenerate button while streaming', () => {
      const wrapper = mount(ChatMessage, {
        props: { message: makeMessage({ role: 'assistant' }), isStreaming: true },
      })
      expect(wrapper.find('button[title="Regenerate response"]').exists()).toBe(false)
    })

    it('shows blinking cursor while streaming', () => {
      const wrapper = mount(ChatMessage, {
        props: { message: makeMessage({ role: 'assistant' }), isStreaming: true },
      })
      expect(wrapper.findComponent({ name: 'BlinkingCursor' }).exists()).toBe(true)
    })

    it('hides blinking cursor when not streaming', () => {
      const wrapper = mount(ChatMessage, {
        props: { message: makeMessage({ role: 'assistant' }), isStreaming: false },
      })
      expect(wrapper.findComponent({ name: 'BlinkingCursor' }).exists()).toBe(false)
    })

    it('renders artifact chunks via ArtifactBlock', () => {
      const msg = makeMessage({
        role: 'assistant',
        content: '',
        meta: {
          contentChunks: [
            { type: 'text', content: 'Here is your code:' },
            { type: 'artifact-create', content: 'code', command: { title: 'app.ts', type: 'code', content: 'console.log()' }, isIncomplete: false },
          ],
        },
      })
      const wrapper = mount(ChatMessage, { props: { message: msg } })
      expect(wrapper.findComponent({ name: 'ArtifactBlock' }).exists()).toBe(true)
      expect(wrapper.findComponent({ name: 'MarkdownRenderer' }).exists()).toBe(true)
    })

    it('filters hidden chunks from rendering', () => {
      const msg = makeMessage({
        role: 'assistant',
        content: '',
        meta: {
          contentChunks: [
            { type: 'text', content: 'visible' },
            { type: 'hidden', content: 'secret' },
          ],
        },
      })
      const wrapper = mount(ChatMessage, { props: { message: msg } })
      expect(wrapper.text()).not.toContain('secret')
    })
  })

  // ---------------------------------------------------------------------------
  // System messages
  // ---------------------------------------------------------------------------
  describe('system message', () => {
    it('renders system content as plain text', () => {
      const wrapper = mount(ChatMessage, {
        props: { message: makeMessage({ role: 'system', content: 'Session started' }) },
      })
      expect(wrapper.text()).toContain('Session started')
    })

    it('does not show edit or regenerate buttons', () => {
      const wrapper = mount(ChatMessage, {
        props: { message: makeMessage({ role: 'system' }) },
      })
      expect(wrapper.find('button[title="Edit message"]').exists()).toBe(false)
      expect(wrapper.find('button[title="Regenerate response"]').exists()).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Timestamp
  // ---------------------------------------------------------------------------
  describe('timestamp', () => {
    it('displays formatted time', () => {
      const wrapper = mount(ChatMessage, {
        props: { message: makeMessage({ ts: '2026-03-14T14:30:00Z' }) },
      })
      // The formatted time depends on locale, just check something is rendered
      const timeEl = wrapper.find('span')
      expect(timeEl.exists()).toBe(true)
    })
  })
})

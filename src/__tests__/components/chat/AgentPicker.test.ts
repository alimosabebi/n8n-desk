import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentPicker from '@/components/chat/AgentPicker.vue'
import type { ChatModelDto } from '@/types/chathub'

// Stub Ionic components
const ionicStubs = {
  IonModal: { template: '<div v-if="isOpen"><slot /></div>', props: ['isOpen'], emits: ['didDismiss'] },
  IonHeader: { template: '<div><slot /></div>' },
  IonToolbar: { template: '<div><slot /></div>' },
  IonTitle: { template: '<div><slot /></div>' },
  IonContent: { template: '<div><slot /></div>' },
  IonSearchbar: { template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />', props: ['modelValue', 'placeholder', 'debounce'] },
  IonList: { template: '<div><slot /></div>' },
  IonItem: { template: '<div class="ion-item" @click="$attrs.onClick?.()"><slot /></div>', props: ['button', 'disabled'] },
  IonLabel: { template: '<div><slot /></div>' },
  IonNote: { template: '<span><slot /></span>' },
  IonButtons: { template: '<div><slot /></div>' },
  IonButton: { template: '<button @click="$emit(\'click\')"><slot /></button>' },
  IonIcon: { template: '<span />', props: ['icon'] },
}

function makeAgent(overrides: Partial<ChatModelDto> & { provider?: string; name?: string } = {}): ChatModelDto {
  const { provider = 'openai', name = 'GPT-4', ...rest } = overrides
  return {
    model: { provider: provider as 'openai', model: 'gpt-4' },
    name,
    description: null,
    icon: null,
    updatedAt: null,
    createdAt: null,
    metadata: { allowFileUploads: false, allowedFilesMimeTypes: '', capabilities: { functionCalling: true }, available: true },
    groupName: null,
    groupIcon: null,
    ...rest,
  }
}

function mountPicker(props: Record<string, unknown> = {}) {
  return mount(AgentPicker, {
    props: {
      isOpen: true,
      agents: [],
      ...props,
    },
    global: { stubs: ionicStubs },
  })
}

describe('AgentPicker', () => {
  // ---------------------------------------------------------------------------
  // Grouping
  // ---------------------------------------------------------------------------
  describe('grouping', () => {
    it('groups agents by provider', () => {
      const agents = [
        makeAgent({ provider: 'openai', name: 'GPT-4' }),
        makeAgent({ provider: 'openai', name: 'GPT-3.5' }),
        makeAgent({ provider: 'anthropic', name: 'Claude' }),
      ]
      const wrapper = mountPicker({ agents })
      const text = wrapper.text()
      expect(text).toContain('OpenAI')
      expect(text).toContain('Anthropic')
      expect(text).toContain('GPT-4')
      expect(text).toContain('Claude')
    })

    it('shows n8n agents as "Workflow Agents"', () => {
      const agents = [
        makeAgent({ provider: 'n8n', name: 'Invoice Bot', model: { provider: 'n8n', workflowId: 'w1' } as never }),
      ]
      const wrapper = mountPicker({ agents })
      expect(wrapper.text()).toContain('Workflow Agents')
    })

    it('orders n8n agents before LLM providers', () => {
      const agents = [
        makeAgent({ provider: 'openai', name: 'GPT-4' }),
        makeAgent({ provider: 'n8n', name: 'Bot', model: { provider: 'n8n', workflowId: 'w1' } as never }),
      ]
      const wrapper = mountPicker({ agents })
      const text = wrapper.text()
      const n8nIdx = text.indexOf('Workflow Agents')
      const openaiIdx = text.indexOf('OpenAI')
      expect(n8nIdx).toBeLessThan(openaiIdx)
    })
  })

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------
  describe('selection', () => {
    it('emits select when clicking an available agent', async () => {
      const agent = makeAgent()
      const wrapper = mountPicker({ agents: [agent] })

      const items = wrapper.findAll('.ion-item')
      expect(items.length).toBeGreaterThan(0)
      await items[0].trigger('click')

      expect(wrapper.emitted('select')).toBeDefined()
      expect(wrapper.emitted('select')![0][0]).toEqual(agent)
    })

    it('does not emit select for unavailable agents', async () => {
      const agent = makeAgent({
        metadata: { allowFileUploads: false, allowedFilesMimeTypes: '', capabilities: { functionCalling: true }, available: false },
      })
      const wrapper = mountPicker({ agents: [agent] })

      const items = wrapper.findAll('div')
      const agentItem = items.find((el) => el.text().includes('GPT-4'))
      await agentItem!.trigger('click')

      expect(wrapper.emitted('select')).toBeUndefined()
    })

    it('shows "Unavailable" badge for unavailable agents', () => {
      const agent = makeAgent({
        metadata: { allowFileUploads: false, allowedFilesMimeTypes: '', capabilities: { functionCalling: true }, available: false },
      })
      const wrapper = mountPicker({ agents: [agent] })
      expect(wrapper.text()).toContain('Unavailable')
    })
  })

  // ---------------------------------------------------------------------------
  // Search / filtering
  // ---------------------------------------------------------------------------
  describe('search', () => {
    it('filters agents by name', async () => {
      const agents = [
        makeAgent({ name: 'Claude Sonnet' }),
        makeAgent({ name: 'GPT-4', provider: 'openai' }),
      ]
      const wrapper = mountPicker({ agents })
      const input = wrapper.find('input')
      await input.setValue('claude')

      expect(wrapper.text()).toContain('Claude Sonnet')
      expect(wrapper.text()).not.toContain('GPT-4')
    })

    it('filters agents by provider', async () => {
      const agents = [
        makeAgent({ name: 'Model A', provider: 'anthropic' }),
        makeAgent({ name: 'Model B', provider: 'openai' }),
      ]
      const wrapper = mountPicker({ agents })
      await wrapper.find('input').setValue('anthropic')

      expect(wrapper.text()).toContain('Model A')
      expect(wrapper.text()).not.toContain('Model B')
    })

    it('shows empty state when no results', async () => {
      const wrapper = mountPicker({ agents: [makeAgent()] })
      await wrapper.find('input').setValue('nonexistent')

      expect(wrapper.text()).toContain('No agents or models match')
    })

    it('shows empty state with no agents', () => {
      const wrapper = mountPicker({ agents: [] })
      expect(wrapper.text()).toContain('No agents or models available')
    })
  })

  // ---------------------------------------------------------------------------
  // Close
  // ---------------------------------------------------------------------------
  describe('close', () => {
    it('emits update:isOpen(false) when closing', async () => {
      const wrapper = mountPicker()
      const closeBtn = wrapper.find('button')
      await closeBtn.trigger('click')

      const emitted = wrapper.emitted('update:isOpen')!
      expect(emitted).toBeDefined()
      expect(emitted.some((args) => args[0] === false)).toBe(true)
    })
  })
})

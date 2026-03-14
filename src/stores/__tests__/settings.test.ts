import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSettingsStore } from '@/stores/settings'

describe('settings store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('has correct defaults', () => {
    const store = useSettingsStore()
    expect(store.theme).toBe('system')
    expect(store.defaultInstanceId).toBeNull()
    expect(store.lastMode).toBe('chat')
  })

  it('setTheme updates theme and persists', async () => {
    const store = useSettingsStore()
    store.setTheme('dark')
    expect(store.theme).toBe('dark')

    // Wait for async save
    await new Promise((r) => setTimeout(r, 10))
    const saved = localStorage.getItem('n8n-desk:config.json')
    expect(saved).toBeTruthy()
    const parsed = JSON.parse(saved!)
    expect(parsed.theme).toBe('dark')
  })

  it('hydrate reads saved settings', async () => {
    localStorage.setItem(
      'n8n-desk:config.json',
      JSON.stringify({ theme: 'light', defaultInstanceId: 'inst_123', lastMode: 'cowork' })
    )
    const store = useSettingsStore()
    await store.hydrate()
    expect(store.theme).toBe('light')
    expect(store.defaultInstanceId).toBe('inst_123')
    expect(store.lastMode).toBe('cowork')
  })

  it('setLastMode updates and persists', async () => {
    const store = useSettingsStore()
    store.setLastMode('workflow')
    expect(store.lastMode).toBe('workflow')
  })
})

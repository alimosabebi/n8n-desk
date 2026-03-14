import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { usePlatform } from '@/composables/usePlatform'

describe('usePlatform', () => {
  const originalN8nDesk = window.n8nDesk

  beforeEach(() => {
    delete window.n8nDesk
  })

  afterEach(() => {
    if (originalN8nDesk) {
      window.n8nDesk = originalN8nDesk
    }
  })

  it('detects web platform when no bridge is present', () => {
    const { platform, isElectron, isNative } = usePlatform()
    expect(platform.value).toBe('web')
    expect(isElectron.value).toBe(false)
    expect(isNative.value).toBe(false)
  })

  it('detects electron when n8nDesk bridge is present', () => {
    window.n8nDesk = {
      storage: { read: async () => null, write: async () => {}, append: async () => {} },
      auth: { login: async () => ({}), logout: async () => {}, refresh: async () => ({}) },
      agent: { invoke: async () => ({}), stop: async () => {}, approve: async () => {}, onEvent: () => {} },
      keychain: { get: async () => null, set: async () => {}, delete: async () => {} },
    }
    const { platform, isElectron } = usePlatform()
    expect(platform.value).toBe('electron')
    expect(isElectron.value).toBe(true)
  })
})

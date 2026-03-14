import { describe, it, expect, beforeEach } from 'vitest'
import { localStorageService } from '@/services/local-storage'

describe('localStorageService (web fallback)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('readJson returns null for missing files', async () => {
    const result = await localStorageService.readJson('nonexistent.json')
    expect(result).toBeNull()
  })

  it('writeJson + readJson round-trips', async () => {
    const data = { name: 'test', value: 42 }
    await localStorageService.writeJson('test.json', data)
    const result = await localStorageService.readJson<typeof data>('test.json')
    expect(result).toEqual(data)
  })

  it('appendJsonl + readJsonl round-trips', async () => {
    await localStorageService.appendJsonl('test.jsonl', { id: 1, text: 'hello' })
    await localStorageService.appendJsonl('test.jsonl', { id: 2, text: 'world' })
    const items = await localStorageService.readJsonl<{ id: number; text: string }>('test.jsonl')
    expect(items).toHaveLength(2)
    expect(items[0].text).toBe('hello')
    expect(items[1].text).toBe('world')
  })

  it('exists returns correct boolean', async () => {
    expect(await localStorageService.exists('nope.json')).toBe(false)
    await localStorageService.writeJson('yep.json', {})
    expect(await localStorageService.exists('yep.json')).toBe(true)
  })

  it('initDirectory creates default files', async () => {
    await localStorageService.initDirectory()
    const config = await localStorageService.readJson<Record<string, unknown>>('config.json')
    expect(config).toBeTruthy()
    expect(config!.theme).toBe('system')
  })
})

/**
 * Local storage service for ~/.n8n-desk/ persistence.
 *
 * Platform routing:
 * - Electron: IPC calls to main process (fs operations)
 * - Capacitor: Capacitor Filesystem API
 * - Web (dev): localStorage fallback
 */

function isElectron(): boolean {
  return typeof window !== 'undefined' && window.n8nDesk !== undefined
}

// Web/dev fallback using localStorage
const webFallback = {
  async read(path: string): Promise<string | null> {
    return localStorage.getItem(`n8n-desk:${path}`)
  },
  async write(path: string, data: string): Promise<void> {
    localStorage.setItem(`n8n-desk:${path}`, data)
  },
  async append(path: string, line: string): Promise<void> {
    const existing = localStorage.getItem(`n8n-desk:${path}`) ?? ''
    localStorage.setItem(`n8n-desk:${path}`, existing + line + '\n')
  },
}

function getBackend() {
  if (isElectron()) {
    return {
      read: (path: string) => window.n8nDesk!.storage.read(path),
      write: (path: string, data: string) => window.n8nDesk!.storage.write(path, data),
      append: (path: string, line: string) => window.n8nDesk!.storage.append(path, line),
    }
  }
  // TODO: Add Capacitor Filesystem backend
  return webFallback
}

export const localStorageService = {
  async readJson<T>(relativePath: string): Promise<T | null> {
    const backend = getBackend()
    const raw = await backend.read(relativePath)
    if (raw === null) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  },

  async writeJson(relativePath: string, data: unknown): Promise<void> {
    const backend = getBackend()
    await backend.write(relativePath, JSON.stringify(data, null, 2))
  },

  async readJsonl<T>(relativePath: string): Promise<T[]> {
    const backend = getBackend()
    const raw = await backend.read(relativePath)
    if (raw === null) return []
    return raw
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => {
        try {
          return JSON.parse(line) as T
        } catch {
          return null
        }
      })
      .filter((item): item is T => item !== null)
  },

  async appendJsonl(relativePath: string, item: unknown): Promise<void> {
    const backend = getBackend()
    await backend.append(relativePath, JSON.stringify(item))
  },

  async exists(relativePath: string): Promise<boolean> {
    const backend = getBackend()
    const result = await backend.read(relativePath)
    return result !== null
  },

  async initDirectory(): Promise<void> {
    // Create default files if they don't exist
    const configExists = await this.exists('config.json')
    if (!configExists) {
      await this.writeJson('config.json', {
        theme: 'system',
        defaultInstanceId: null,
        lastMode: 'chat',
      })
    }

    const llmExists = await this.exists('llm.json')
    if (!llmExists) {
      await this.writeJson('llm.json', {})
    }
  },
}

import { ipcMain } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { pluginManager } from '../plugin-manager'
import { loadAllSkills, saveUserSkill, deleteUserSkill } from '../skill-loader'

const BASE_DIR = path.join(os.homedir(), '.n8n-desk')

// --- Helpers ---

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

/**
 * Read the active instance ID from config.json.
 * Server-scoped handlers require an instance context (standalone MCP servers
 * are stored per-instance in mcp-servers.json).
 */
async function getActiveInstanceId(): Promise<string | null> {
  const config = await readJson<{ defaultInstanceId?: string }>(path.join(BASE_DIR, 'config.json'))
  return config?.defaultInstanceId ?? null
}

// --- IPC Handlers ---

let handlersRegistered = false

export function registerPluginHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  // ── Marketplace ──

  ipcMain.handle('plugins:marketplace-list', async () => {
    try {
      const marketplaces = await pluginManager.getMarketplaces()
      return marketplaces
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('plugins:marketplace-add', async (_event, source: { source: 'github' | 'url' | 'local'; repo?: string; url?: string; ref?: string }) => {
    try {
      const marketplace = await pluginManager.addMarketplace(source)
      return { success: true, marketplace }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('plugins:marketplace-remove', async (_event, id: string) => {
    try {
      await pluginManager.removeMarketplace(id)
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('plugins:marketplace-refresh', async (_event, id: string) => {
    try {
      await pluginManager.refreshMarketplace(id)
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  // ── Browse ──

  ipcMain.handle('plugins:browse', async (_event, marketplaceId?: string) => {
    try {
      const plugins = await pluginManager.browsePlugins(marketplaceId)
      return plugins
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  // ── Plugin Lifecycle ──

  ipcMain.handle('plugins:installed-list', async () => {
    try {
      const plugins = await pluginManager.getInstalledPlugins()
      return plugins
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('plugins:install', async (_event, name: string, marketplaceId: string) => {
    try {
      const plugin = await pluginManager.installPlugin(name, marketplaceId)
      return { success: true, plugin }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('plugins:uninstall', async (_event, id: string) => {
    try {
      await pluginManager.uninstallPlugin(id)
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('plugins:enable', async (_event, id: string) => {
    try {
      await pluginManager.enablePlugin(id)
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('plugins:disable', async (_event, id: string) => {
    try {
      await pluginManager.disablePlugin(id)
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('plugins:preview-install', async (_event, name: string, marketplaceId: string) => {
    try {
      const preview = await pluginManager.previewInstall(name, marketplaceId)
      return preview
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { urls: [], headerNames: [], toolCount: 0, error: message }
    }
  })

  // ── Standalone MCP Servers (instance-scoped) ──

  ipcMain.handle('plugins:servers-list', async () => {
    try {
      const instanceId = await getActiveInstanceId()
      if (!instanceId) return []
      const servers = await pluginManager.getStandaloneServers(instanceId)
      return servers
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(
    'plugins:servers-add',
    async (
      _event,
      config: {
        name: string
        description?: string
        url: string
        headerNames?: string[]
        enabled: boolean
        requireApproval: boolean
      },
    ) => {
      try {
        const instanceId = await getActiveInstanceId()
        if (!instanceId) {
          return { success: false, error: 'No active instance configured' }
        }
        const server = await pluginManager.addStandaloneServer(instanceId, config)
        return { success: true, server }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle(
    'plugins:servers-update',
    async (
      _event,
      id: string,
      updates: Record<string, unknown>,
    ) => {
      try {
        const instanceId = await getActiveInstanceId()
        if (!instanceId) {
          return { success: false, error: 'No active instance configured' }
        }
        await pluginManager.updateStandaloneServer(instanceId, id, updates as Partial<{
          name: string
          description?: string
          url: string
          headerNames?: string[]
          enabled: boolean
          requireApproval: boolean
        }>)
        return { success: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle('plugins:servers-remove', async (_event, id: string) => {
    try {
      const instanceId = await getActiveInstanceId()
      if (!instanceId) {
        return { success: false, error: 'No active instance configured' }
      }
      await pluginManager.removeStandaloneServer(instanceId, id)
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(
    'plugins:servers-test',
    async (_event, url: string, headers: Record<string, string>) => {
      try {
        const tools = await pluginManager.discoverTools(url, headers)
        return { success: true, tools }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    },
  )

  // ── Secret Management ──

  ipcMain.handle(
    'plugins:set-secret',
    async (_event, namespace: 'plugin' | 'server', id: string, headerName: string, value: string) => {
      try {
        await pluginManager.setSecret(namespace, id, headerName, value)
        return { success: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle(
    'plugins:delete-secrets',
    async (_event, namespace: 'plugin' | 'server', id: string) => {
      try {
        const instanceId = namespace === 'server' ? await getActiveInstanceId() : undefined
        await pluginManager.deleteSecrets(namespace, id, instanceId ?? undefined)
        return { success: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    },
  )

  // ── Skills ──

  ipcMain.handle('plugins:list-skills', async () => {
    try {
      const skills = await loadAllSkills()
      return skills
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(
    'plugins:save-skill',
    async (_event, skill: { name: string; content: string }) => {
      try {
        await saveUserSkill(skill.name, skill.content)
        return { success: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle('plugins:delete-skill', async (_event, name: string) => {
    try {
      await deleteUserSkill(name)
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })
}

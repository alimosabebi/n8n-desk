import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePluginsStore } from '@/stores/plugins'
import type {
  Marketplace,
  MarketplacePluginEntry,
  InstalledPlugin,
  StandaloneMcpServer,
  LoadedSkill,
  DiscoveredTool,
} from '@/types/plugin'

// --- Mock bridge ---

function createMockBridge() {
  return {
    marketplaceList: vi.fn().mockResolvedValue([]),
    marketplaceRefresh: vi.fn().mockResolvedValue({ success: true }),
    marketplaceAdd: vi.fn(),
    marketplaceRemove: vi.fn().mockResolvedValue({ success: true }),
    browse: vi.fn().mockResolvedValue([]),
    installedList: vi.fn().mockResolvedValue([]),
    install: vi.fn(),
    uninstall: vi.fn().mockResolvedValue({ success: true }),
    enable: vi.fn().mockResolvedValue({ success: true }),
    disable: vi.fn().mockResolvedValue({ success: true }),
    serversList: vi.fn().mockResolvedValue([]),
    serversAdd: vi.fn(),
    serversUpdate: vi.fn().mockResolvedValue({ success: true }),
    serversRemove: vi.fn().mockResolvedValue({ success: true }),
    serversTest: vi.fn(),
    setSecret: vi.fn().mockResolvedValue({ success: true }),
    listSkills: vi.fn().mockResolvedValue([]),
    saveSkill: vi.fn().mockResolvedValue({ success: true }),
    deleteSkill: vi.fn().mockResolvedValue({ success: true }),
  }
}

let mockBridge: ReturnType<typeof createMockBridge>

beforeEach(() => {
  mockBridge = createMockBridge()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).window = {
    n8nDesk: {
      plugins: mockBridge,
    },
  }
})

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).window
})

// --- Helpers ---

function makeMarketplace(overrides: Partial<Marketplace> = {}): Marketplace {
  return {
    id: 'mkt_1',
    name: 'Test Marketplace',
    owner: { name: 'Test Owner' },
    source: { source: 'github', repo: 'owner/repo' },
    plugins: [],
    addedAt: '2026-03-14T10:00:00Z',
    autoUpdate: false,
    ...overrides,
  }
}

function makePlugin(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    id: 'plugin_1',
    name: 'test-plugin',
    pluginDir: '/path/to/plugin',
    enabled: true,
    installedAt: '2026-03-14T10:00:00Z',
    ...overrides,
  }
}

function makeServer(overrides: Partial<StandaloneMcpServer> = {}): StandaloneMcpServer {
  return {
    id: 'srv_1',
    name: 'Test Server',
    url: 'https://api.example.com/mcp',
    enabled: true,
    requireApproval: true,
    addedAt: '2026-03-14T10:00:00Z',
    ...overrides,
  }
}

function makeSkill(overrides: Partial<LoadedSkill> = {}): LoadedSkill {
  return {
    name: 'test-skill',
    description: 'A test skill',
    content: 'skill content',
    disableModelInvocation: false,
    userInvocable: true,
    directory: '/skills',
    source: 'user',
    ...overrides,
  }
}

describe('usePluginsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  // ---------------------------------------------------------------------------
  // Default state
  // ---------------------------------------------------------------------------
  describe('defaults', () => {
    it('has correct initial state', () => {
      const store = usePluginsStore()
      expect(store.marketplaces).toEqual([])
      expect(store.installedPlugins).toEqual([])
      expect(store.standaloneServers).toEqual([])
      expect(store.skills).toEqual([])
      expect(store.isLoading).toBe(false)
    })

    it('has empty computed properties', () => {
      const store = usePluginsStore()
      expect(store.enabledPlugins).toEqual([])
      expect(store.enabledServers).toEqual([])
      expect(store.allToolSources).toEqual([])
    })
  })

  // ---------------------------------------------------------------------------
  // Hydration
  // ---------------------------------------------------------------------------
  describe('hydrate', () => {
    it('loads all data from bridge in parallel', async () => {
      const mkt = makeMarketplace()
      const plugin = makePlugin()
      const server = makeServer()
      const skill = makeSkill()

      mockBridge.marketplaceList.mockResolvedValue([mkt])
      mockBridge.installedList.mockResolvedValue([plugin])
      mockBridge.serversList.mockResolvedValue([server])
      mockBridge.listSkills.mockResolvedValue([skill])

      const store = usePluginsStore()
      await store.hydrate()

      expect(store.marketplaces).toEqual([mkt])
      expect(store.installedPlugins).toEqual([plugin])
      expect(store.standaloneServers).toEqual([server])
      expect(store.skills).toEqual([skill])
      expect(store.isLoading).toBe(false)
    })

    it('sets isLoading during hydration', async () => {
      const store = usePluginsStore()

      let capturedLoading = false
      mockBridge.marketplaceList.mockImplementation(async () => {
        capturedLoading = store.isLoading
        return []
      })

      await store.hydrate()

      expect(capturedLoading).toBe(true)
      expect(store.isLoading).toBe(false)
    })

    it('sets isLoading to false even when hydration fails', async () => {
      mockBridge.marketplaceList.mockResolvedValue({ success: false, error: 'fetch failed' })

      const store = usePluginsStore()
      await expect(store.hydrate()).rejects.toThrow('fetch failed')
      expect(store.isLoading).toBe(false)
    })

    it('handles empty bridge responses', async () => {
      const store = usePluginsStore()
      await store.hydrate()

      expect(store.marketplaces).toEqual([])
      expect(store.installedPlugins).toEqual([])
      expect(store.standaloneServers).toEqual([])
      expect(store.skills).toEqual([])
    })
  })

  // ---------------------------------------------------------------------------
  // Marketplace actions
  // ---------------------------------------------------------------------------
  describe('marketplace actions', () => {
    it('addMarketplace pushes to state', async () => {
      const mkt = makeMarketplace()
      mockBridge.marketplaceAdd.mockResolvedValue({ marketplace: mkt })

      const store = usePluginsStore()
      const result = await store.addMarketplace({ source: 'github', repo: 'owner/repo' })

      expect(result).toEqual(mkt)
      expect(store.marketplaces).toHaveLength(1)
      expect(store.marketplaces[0].id).toBe('mkt_1')
    })

    it('addMarketplace throws on error', async () => {
      mockBridge.marketplaceAdd.mockResolvedValue({ success: false, error: 'invalid source' })

      const store = usePluginsStore()
      await expect(
        store.addMarketplace({ source: 'github', repo: 'bad/repo' }),
      ).rejects.toThrow('invalid source')
    })

    it('removeMarketplace filters from state', async () => {
      const store = usePluginsStore()
      store.marketplaces = [makeMarketplace({ id: 'mkt_a' }), makeMarketplace({ id: 'mkt_b' })]

      await store.removeMarketplace('mkt_a')

      expect(store.marketplaces).toHaveLength(1)
      expect(store.marketplaces[0].id).toBe('mkt_b')
    })

    it('removeMarketplace throws on error', async () => {
      mockBridge.marketplaceRemove.mockResolvedValue({ success: false, error: 'not found' })

      const store = usePluginsStore()
      await expect(store.removeMarketplace('mkt_x')).rejects.toThrow('not found')
    })

    it('refreshMarketplace calls bridge and rehydrates', async () => {
      const mkt = makeMarketplace()
      mockBridge.marketplaceRefresh.mockResolvedValue({ success: true })
      mockBridge.marketplaceList.mockResolvedValue([mkt])

      const store = usePluginsStore()
      await store.refreshMarketplace('mkt_1')

      expect(mockBridge.marketplaceRefresh).toHaveBeenCalledWith('mkt_1')
      expect(mockBridge.marketplaceList).toHaveBeenCalled()
      expect(store.marketplaces).toEqual([mkt])
    })

    it('refreshMarketplace throws on error', async () => {
      mockBridge.marketplaceRefresh.mockResolvedValue({ success: false, error: 'timeout' })

      const store = usePluginsStore()
      await expect(store.refreshMarketplace('mkt_1')).rejects.toThrow('timeout')
    })
  })

  // ---------------------------------------------------------------------------
  // Browse
  // ---------------------------------------------------------------------------
  describe('browsePlugins', () => {
    it('returns plugin entries from bridge', async () => {
      const entries: MarketplacePluginEntry[] = [
        { name: 'plugin-a', source: 'github', description: 'Plugin A' },
        { name: 'plugin-b', source: 'github', description: 'Plugin B' },
      ]
      mockBridge.browse.mockResolvedValue(entries)

      const store = usePluginsStore()
      const result = await store.browsePlugins('mkt_1')

      expect(result).toEqual(entries)
      expect(mockBridge.browse).toHaveBeenCalledWith('mkt_1')
    })

    it('throws on error', async () => {
      mockBridge.browse.mockResolvedValue({ success: false, error: 'unavailable' })

      const store = usePluginsStore()
      await expect(store.browsePlugins('mkt_1')).rejects.toThrow('unavailable')
    })
  })

  // ---------------------------------------------------------------------------
  // Plugin lifecycle
  // ---------------------------------------------------------------------------
  describe('plugin lifecycle', () => {
    it('installPlugin pushes to installed list', async () => {
      const plugin = makePlugin({ id: 'plugin_new', name: 'new-plugin' })
      mockBridge.install.mockResolvedValue({ plugin })

      const store = usePluginsStore()
      const result = await store.installPlugin('new-plugin', 'mkt_1')

      expect(result).toEqual(plugin)
      expect(store.installedPlugins).toHaveLength(1)
      expect(store.installedPlugins[0].name).toBe('new-plugin')
    })

    it('installPlugin throws on error', async () => {
      mockBridge.install.mockResolvedValue({ success: false, error: 'install failed' })

      const store = usePluginsStore()
      await expect(store.installPlugin('bad', 'mkt_1')).rejects.toThrow('install failed')
    })

    it('uninstallPlugin removes from installed list', async () => {
      const store = usePluginsStore()
      store.installedPlugins = [
        makePlugin({ id: 'keep' }),
        makePlugin({ id: 'remove' }),
      ]

      await store.uninstallPlugin('remove')

      expect(store.installedPlugins).toHaveLength(1)
      expect(store.installedPlugins[0].id).toBe('keep')
    })

    it('uninstallPlugin throws on error', async () => {
      mockBridge.uninstall.mockResolvedValue({ success: false, error: 'permission denied' })

      const store = usePluginsStore()
      await expect(store.uninstallPlugin('plugin_1')).rejects.toThrow('permission denied')
    })

    it('togglePlugin enables a disabled plugin', async () => {
      const store = usePluginsStore()
      store.installedPlugins = [makePlugin({ id: 'p1', enabled: false })]

      await store.togglePlugin('p1')

      expect(mockBridge.enable).toHaveBeenCalledWith('p1')
      expect(store.installedPlugins[0].enabled).toBe(true)
    })

    it('togglePlugin disables an enabled plugin', async () => {
      const store = usePluginsStore()
      store.installedPlugins = [makePlugin({ id: 'p1', enabled: true })]

      await store.togglePlugin('p1')

      expect(mockBridge.disable).toHaveBeenCalledWith('p1')
      expect(store.installedPlugins[0].enabled).toBe(false)
    })

    it('togglePlugin does nothing for unknown plugin', async () => {
      const store = usePluginsStore()
      store.installedPlugins = [makePlugin({ id: 'p1' })]

      await store.togglePlugin('nonexistent')

      expect(mockBridge.enable).not.toHaveBeenCalled()
      expect(mockBridge.disable).not.toHaveBeenCalled()
    })

    it('togglePlugin throws on error', async () => {
      mockBridge.disable.mockResolvedValue({ success: false, error: 'toggle failed' })

      const store = usePluginsStore()
      store.installedPlugins = [makePlugin({ id: 'p1', enabled: true })]

      await expect(store.togglePlugin('p1')).rejects.toThrow('toggle failed')
    })
  })

  // ---------------------------------------------------------------------------
  // Standalone MCP servers
  // ---------------------------------------------------------------------------
  describe('server actions', () => {
    it('addServer pushes to server list', async () => {
      const server = makeServer({ id: 'srv_new', name: 'New Server' })
      mockBridge.serversAdd.mockResolvedValue({ server })

      const store = usePluginsStore()
      const result = await store.addServer({
        name: 'New Server',
        url: 'https://api.example.com/mcp',
        enabled: true,
        requireApproval: true,
      })

      expect(result).toEqual(server)
      expect(store.standaloneServers).toHaveLength(1)
      expect(store.standaloneServers[0].name).toBe('New Server')
    })

    it('addServer throws on error', async () => {
      mockBridge.serversAdd.mockResolvedValue({ success: false, error: 'invalid url' })

      const store = usePluginsStore()
      await expect(
        store.addServer({ name: 'Bad', url: 'bad', enabled: true, requireApproval: true }),
      ).rejects.toThrow('invalid url')
    })

    it('updateServer calls bridge and rehydrates', async () => {
      const updated = makeServer({ id: 'srv_1', name: 'Updated Server' })
      mockBridge.serversList.mockResolvedValue([updated])

      const store = usePluginsStore()
      store.standaloneServers = [makeServer({ id: 'srv_1', name: 'Old Server' })]

      await store.updateServer('srv_1', { name: 'Updated Server' })

      expect(mockBridge.serversUpdate).toHaveBeenCalledWith('srv_1', { name: 'Updated Server' })
      expect(store.standaloneServers[0].name).toBe('Updated Server')
    })

    it('updateServer throws on error', async () => {
      mockBridge.serversUpdate.mockResolvedValue({ success: false, error: 'not found' })

      const store = usePluginsStore()
      await expect(store.updateServer('srv_x', {})).rejects.toThrow('not found')
    })

    it('removeServer filters from server list', async () => {
      const store = usePluginsStore()
      store.standaloneServers = [
        makeServer({ id: 'srv_keep' }),
        makeServer({ id: 'srv_remove' }),
      ]

      await store.removeServer('srv_remove')

      expect(store.standaloneServers).toHaveLength(1)
      expect(store.standaloneServers[0].id).toBe('srv_keep')
    })

    it('removeServer throws on error', async () => {
      mockBridge.serversRemove.mockResolvedValue({ success: false, error: 'in use' })

      const store = usePluginsStore()
      await expect(store.removeServer('srv_1')).rejects.toThrow('in use')
    })

    it('testServer returns discovered tools', async () => {
      const tools: DiscoveredTool[] = [
        { serverName: 'test', name: 'tool_1', description: 'A tool' },
        { serverName: 'test', name: 'tool_2' },
      ]
      mockBridge.serversTest.mockResolvedValue({ tools })

      const store = usePluginsStore()
      const result = await store.testServer('https://api.example.com/mcp', { Auth: 'token' })

      expect(result).toEqual(tools)
      expect(mockBridge.serversTest).toHaveBeenCalledWith('https://api.example.com/mcp', {
        Auth: 'token',
      })
    })

    it('testServer throws on error', async () => {
      mockBridge.serversTest.mockResolvedValue({ success: false, error: 'connection refused' })

      const store = usePluginsStore()
      await expect(store.testServer('bad-url', {})).rejects.toThrow('connection refused')
    })
  })

  // ---------------------------------------------------------------------------
  // Secret management
  // ---------------------------------------------------------------------------
  describe('setSecret', () => {
    it('calls bridge with correct arguments', async () => {
      const store = usePluginsStore()
      await store.setSecret('plugin', 'plugin_1', 'Authorization', 'Bearer token')

      expect(mockBridge.setSecret).toHaveBeenCalledWith(
        'plugin',
        'plugin_1',
        'Authorization',
        'Bearer token',
      )
    })

    it('throws on error', async () => {
      mockBridge.setSecret.mockResolvedValue({ success: false, error: 'keychain locked' })

      const store = usePluginsStore()
      await expect(
        store.setSecret('server', 'srv_1', 'X-API-Key', 'secret'),
      ).rejects.toThrow('keychain locked')
    })
  })

  // ---------------------------------------------------------------------------
  // Skills
  // ---------------------------------------------------------------------------
  describe('skills', () => {
    it('loadSkills populates skills array', async () => {
      const skills = [makeSkill({ name: 'skill-a' }), makeSkill({ name: 'skill-b' })]
      mockBridge.listSkills.mockResolvedValue(skills)

      const store = usePluginsStore()
      await store.loadSkills()

      expect(store.skills).toEqual(skills)
    })

    it('loadSkills throws on error', async () => {
      mockBridge.listSkills.mockResolvedValue({ success: false, error: 'read failed' })

      const store = usePluginsStore()
      await expect(store.loadSkills()).rejects.toThrow('read failed')
    })

    it('saveSkill calls bridge and reloads', async () => {
      const savedSkills = [makeSkill({ name: 'new-skill' })]
      mockBridge.listSkills.mockResolvedValue(savedSkills)

      const store = usePluginsStore()
      await store.saveSkill({ name: 'new-skill', content: 'skill content' })

      expect(mockBridge.saveSkill).toHaveBeenCalledWith({
        name: 'new-skill',
        content: 'skill content',
      })
      expect(store.skills).toEqual(savedSkills)
    })

    it('saveSkill throws on error', async () => {
      mockBridge.saveSkill.mockResolvedValue({ success: false, error: 'write failed' })

      const store = usePluginsStore()
      await expect(store.saveSkill({ name: 'bad', content: '' })).rejects.toThrow('write failed')
    })

    it('deleteSkill removes from skills array', async () => {
      const store = usePluginsStore()
      store.skills = [makeSkill({ name: 'keep' }), makeSkill({ name: 'remove' })]

      await store.deleteSkill('remove')

      expect(store.skills).toHaveLength(1)
      expect(store.skills[0].name).toBe('keep')
    })

    it('deleteSkill throws on error', async () => {
      mockBridge.deleteSkill.mockResolvedValue({ success: false, error: 'delete failed' })

      const store = usePluginsStore()
      await expect(store.deleteSkill('bad')).rejects.toThrow('delete failed')
    })
  })

  // ---------------------------------------------------------------------------
  // Computed: enabledPlugins / enabledServers
  // ---------------------------------------------------------------------------
  describe('computed: enabledPlugins', () => {
    it('filters to only enabled plugins', () => {
      const store = usePluginsStore()
      store.installedPlugins = [
        makePlugin({ id: 'p1', enabled: true }),
        makePlugin({ id: 'p2', enabled: false }),
        makePlugin({ id: 'p3', enabled: true }),
      ]

      expect(store.enabledPlugins).toHaveLength(2)
      expect(store.enabledPlugins.map((p) => p.id)).toEqual(['p1', 'p3'])
    })
  })

  describe('computed: enabledServers', () => {
    it('filters to only enabled servers', () => {
      const store = usePluginsStore()
      store.standaloneServers = [
        makeServer({ id: 's1', enabled: false }),
        makeServer({ id: 's2', enabled: true }),
      ]

      expect(store.enabledServers).toHaveLength(1)
      expect(store.enabledServers[0].id).toBe('s2')
    })
  })

  // ---------------------------------------------------------------------------
  // Computed: allToolSources
  // ---------------------------------------------------------------------------
  describe('computed: allToolSources', () => {
    it('combines enabled plugin MCP servers and standalone servers', () => {
      const store = usePluginsStore()
      store.installedPlugins = [
        makePlugin({
          id: 'p1',
          name: 'My Plugin',
          enabled: true,
          mcpServers: {
            'api-server': { url: 'https://plugin.example.com/mcp', headerNames: ['Authorization'] },
          },
        }),
      ]
      store.standaloneServers = [
        makeServer({
          id: 's1',
          name: 'Standalone',
          url: 'https://standalone.example.com/mcp',
          enabled: true,
          requireApproval: false,
          headerNames: ['X-API-Key'],
        }),
      ]

      expect(store.allToolSources).toHaveLength(2)

      const pluginSource = store.allToolSources[0]
      expect(pluginSource.type).toBe('plugin')
      expect(pluginSource.id).toBe('p1')
      expect(pluginSource.name).toBe('My Plugin/api-server')
      expect(pluginSource.url).toBe('https://plugin.example.com/mcp')
      expect(pluginSource.headerNames).toEqual(['Authorization'])
      expect(pluginSource.requireApproval).toBe(true)

      const serverSource = store.allToolSources[1]
      expect(serverSource.type).toBe('server')
      expect(serverSource.id).toBe('s1')
      expect(serverSource.name).toBe('Standalone')
      expect(serverSource.url).toBe('https://standalone.example.com/mcp')
      expect(serverSource.headerNames).toEqual(['X-API-Key'])
      expect(serverSource.requireApproval).toBe(false)
    })

    it('excludes disabled plugins and servers', () => {
      const store = usePluginsStore()
      store.installedPlugins = [
        makePlugin({
          id: 'p1',
          enabled: false,
          mcpServers: { srv: { url: 'https://disabled.com/mcp' } },
        }),
      ]
      store.standaloneServers = [
        makeServer({ id: 's1', enabled: false }),
      ]

      expect(store.allToolSources).toHaveLength(0)
    })

    it('handles plugins with multiple MCP servers', () => {
      const store = usePluginsStore()
      store.installedPlugins = [
        makePlugin({
          id: 'p1',
          name: 'Multi',
          enabled: true,
          mcpServers: {
            'server-a': { url: 'https://a.example.com/mcp' },
            'server-b': { url: 'https://b.example.com/mcp' },
          },
        }),
      ]

      expect(store.allToolSources).toHaveLength(2)
      expect(store.allToolSources[0].name).toBe('Multi/server-a')
      expect(store.allToolSources[1].name).toBe('Multi/server-b')
    })

    it('handles plugins without mcpServers', () => {
      const store = usePluginsStore()
      store.installedPlugins = [makePlugin({ id: 'p1', enabled: true })]

      expect(store.allToolSources).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------
  describe('reset', () => {
    it('clears all state to defaults', async () => {
      const store = usePluginsStore()

      // Populate state
      store.marketplaces = [makeMarketplace()]
      store.installedPlugins = [makePlugin()]
      store.standaloneServers = [makeServer()]
      store.skills = [makeSkill()]
      store.isLoading = true

      store.reset()

      expect(store.marketplaces).toEqual([])
      expect(store.installedPlugins).toEqual([])
      expect(store.standaloneServers).toEqual([])
      expect(store.skills).toEqual([])
      expect(store.isLoading).toBe(false)
      expect(store.enabledPlugins).toEqual([])
      expect(store.enabledServers).toEqual([])
      expect(store.allToolSources).toEqual([])
    })
  })

  // ---------------------------------------------------------------------------
  // Bridge unavailable
  // ---------------------------------------------------------------------------
  describe('bridge unavailable', () => {
    it('throws when plugin bridge is not available', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).window = { n8nDesk: {} }

      const store = usePluginsStore()
      await expect(store.hydrate()).rejects.toThrow('Plugin bridge not available')
    })
  })
})

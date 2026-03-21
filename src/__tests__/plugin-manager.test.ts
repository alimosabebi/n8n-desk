import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron — safeStorage is used by plugin-manager for keychain
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn((s: string) => Buffer.from(`encrypted:${s}`)),
    decryptString: vi.fn((b: Buffer) => b.toString('utf-8').replace('encrypted:', '')),
  },
}))

// Mock fs/promises — plugin-manager uses it for JSON read/write and file ops
const mockReadFile = vi.fn()
const mockWriteFile = vi.fn()
const mockMkdir = vi.fn()
const mockUnlink = vi.fn()
const mockRm = vi.fn()
const mockReaddir = vi.fn()
vi.mock('fs/promises', () => ({
  default: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    unlink: (...args: unknown[]) => mockUnlink(...args),
    rm: (...args: unknown[]) => mockRm(...args),
    readdir: (...args: unknown[]) => mockReaddir(...args),
    stat: vi.fn(),
    cp: vi.fn(),
  },
}))

// Mock child_process — used for tar extraction
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    execFile: vi.fn(),
  }
})

// Mock mcp-client — used by plugin-manager and tool-definitions
vi.mock('../../electron/mcp-client', () => ({
  listToolsWithUrl: vi.fn().mockResolvedValue([]),
  callTool: vi.fn(),
  callToolWithUrl: vi.fn(),
}))

// Mock tool-definitions — used by plugin-manager for dynamic tool creation
vi.mock('../../electron/agent/tool-definitions', () => ({
  createDynamicMcpTools: vi.fn().mockResolvedValue([]),
  jsonSchemaToZod: vi.fn(),
}))

import { parseMcpJson, keychainPath, pluginManager } from '../../electron/plugin-manager'

describe('plugin-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --- parseMcpJson: stdio rejection ---

  describe('parseMcpJson', () => {
    it('skips entries with command field (stdio transport)', () => {
      const mcpJson = {
        'stdio-server': {
          command: 'node',
          args: ['server.js'],
        },
      }

      const result = parseMcpJson(mcpJson, 'test-plugin')
      expect(result).toEqual({})
    })

    it('keeps HTTP entries with url field', () => {
      const mcpJson = {
        'http-server': {
          url: 'https://api.example.com/mcp',
        },
      }

      const result = parseMcpJson(mcpJson, 'test-plugin')
      expect(result).toEqual({
        'http-server': {
          url: 'https://api.example.com/mcp',
          headerNames: undefined,
        },
      })
    })

    it('skips entries without url field', () => {
      const mcpJson = {
        'no-url': {
          type: 'http',
          // no url
        },
      }

      const result = parseMcpJson(mcpJson, 'test-plugin')
      expect(result).toEqual({})
    })

    it('extracts header names from entries', () => {
      const mcpJson = {
        'auth-server': {
          url: 'https://api.example.com/mcp',
          headers: {
            Authorization: 'Bearer xxx',
            'X-Custom-Key': 'secret',
          },
        },
      }

      const result = parseMcpJson(mcpJson, 'test-plugin')
      expect(result['auth-server']).toEqual({
        url: 'https://api.example.com/mcp',
        headerNames: ['Authorization', 'X-Custom-Key'],
      })
    })

    it('handles mixed HTTP and stdio entries', () => {
      const mcpJson = {
        'good-http': {
          url: 'https://api.example.com/mcp',
          headers: { Authorization: 'Bearer token' },
        },
        'bad-stdio': {
          command: 'python',
          args: ['-m', 'mcp_server'],
        },
        'another-http': {
          url: 'https://other.example.com/mcp',
        },
        'no-url-no-command': {
          type: 'sse',
        },
      }

      const result = parseMcpJson(mcpJson, 'test-plugin')

      // Only HTTP entries with URL should be present
      expect(Object.keys(result)).toEqual(['good-http', 'another-http'])
      expect(result['good-http'].url).toBe('https://api.example.com/mcp')
      expect(result['good-http'].headerNames).toEqual(['Authorization'])
      expect(result['another-http'].url).toBe('https://other.example.com/mcp')
      expect(result['another-http'].headerNames).toBeUndefined()
    })

    it('returns empty object for empty input', () => {
      const result = parseMcpJson({}, 'test-plugin')
      expect(result).toEqual({})
    })

    it('handles entries with command AND url by skipping (command takes precedence)', () => {
      // If an entry has both command and url, the command field check comes first
      const mcpJson = {
        hybrid: {
          command: 'node',
          url: 'https://api.example.com/mcp',
        },
      }

      const result = parseMcpJson(mcpJson, 'test-plugin')
      expect(result).toEqual({})
    })
  })

  // --- keychainPath: key namespacing ---

  describe('keychainPath', () => {
    it('generates namespaced path for plugin keys', () => {
      const result = keychainPath('n8n-desk:plugin:my-plugin:Authorization')
      // Special characters like colons are replaced with underscores
      expect(result).toContain('n8n-desk_plugin_my-plugin_Authorization')
      expect(result).toContain('.enc')
    })

    it('generates namespaced path for server keys', () => {
      const result = keychainPath('n8n-desk:server:srv-123:X-API-Key')
      expect(result).toContain('n8n-desk_server_srv-123_X-API-Key')
      expect(result).toContain('.enc')
    })

    it('sanitizes special characters in key', () => {
      const result = keychainPath('n8n-desk:plugin:some/path/../weird:header')
      // Extract just the filename from the full path
      const filename = result.split('/').pop()!
      // Slashes, dots, colons in the key are replaced with underscores
      // The filename should not contain the original special chars (except .enc extension)
      expect(filename).not.toContain(':')
      expect(filename).not.toContain('/')
      expect(filename).toBe('n8n-desk_plugin_some_path____weird_header.enc')
    })

    it('preserves alphanumeric, underscore, and hyphen characters', () => {
      const result = keychainPath('abc-123_DEF')
      expect(result).toContain('abc-123_DEF.enc')
    })

    it('produces different paths for different namespaces', () => {
      const pluginPath = keychainPath('n8n-desk:plugin:id1:Auth')
      const serverPath = keychainPath('n8n-desk:server:id1:Auth')
      expect(pluginPath).not.toBe(serverPath)
    })

    it('produces different paths for different plugin IDs', () => {
      const path1 = keychainPath('n8n-desk:plugin:plugin-a:Auth')
      const path2 = keychainPath('n8n-desk:plugin:plugin-b:Auth')
      expect(path1).not.toBe(path2)
    })

    it('produces different paths for different header names', () => {
      const path1 = keychainPath('n8n-desk:plugin:id1:Authorization')
      const path2 = keychainPath('n8n-desk:plugin:id1:X-API-Key')
      expect(path1).not.toBe(path2)
    })
  })

  // --- Credential isolation ---

  describe('credential isolation', () => {
    it('plugin secrets are namespaced with plugin: prefix', async () => {
      mockMkdir.mockResolvedValue(undefined)
      mockWriteFile.mockResolvedValue(undefined)

      await pluginManager.setSecret('plugin', 'my-plugin', 'Authorization', 'Bearer token123')

      expect(mockWriteFile).toHaveBeenCalled()
      const writtenPath = mockWriteFile.mock.calls[0][0] as string
      // Path should contain plugin namespace
      expect(writtenPath).toContain('n8n-desk_plugin_my-plugin_Authorization')
    })

    it('server secrets are namespaced with server: prefix', async () => {
      mockMkdir.mockResolvedValue(undefined)
      mockWriteFile.mockResolvedValue(undefined)

      await pluginManager.setSecret('server', 'srv-456', 'X-API-Key', 'key-secret')

      expect(mockWriteFile).toHaveBeenCalled()
      const writtenPath = mockWriteFile.mock.calls[0][0] as string
      // Path should contain server namespace
      expect(writtenPath).toContain('n8n-desk_server_srv-456_X-API-Key')
    })

    it('plugin and server secrets write to different paths', async () => {
      mockMkdir.mockResolvedValue(undefined)
      mockWriteFile.mockResolvedValue(undefined)

      await pluginManager.setSecret('plugin', 'same-id', 'Auth', 'plugin-token')
      const pluginWritePath = mockWriteFile.mock.calls[0][0] as string

      await pluginManager.setSecret('server', 'same-id', 'Auth', 'server-token')
      const serverWritePath = mockWriteFile.mock.calls[1][0] as string

      // They must be different — credential isolation
      expect(pluginWritePath).not.toBe(serverWritePath)
      expect(pluginWritePath).toContain('plugin')
      expect(serverWritePath).toContain('server')
    })

    it('different plugins write to different keychain paths', async () => {
      mockMkdir.mockResolvedValue(undefined)
      mockWriteFile.mockResolvedValue(undefined)

      await pluginManager.setSecret('plugin', 'plugin-a', 'Auth', 'token-a')
      const pathA = mockWriteFile.mock.calls[0][0] as string

      await pluginManager.setSecret('plugin', 'plugin-b', 'Auth', 'token-b')
      const pathB = mockWriteFile.mock.calls[1][0] as string

      expect(pathA).not.toBe(pathB)
    })
  })

  // --- PluginManager.buildClaudeSdkMcpServers: credential isolation verification ---

  describe('buildClaudeSdkMcpServers', () => {
    it('returns empty object when no plugins or servers are configured', async () => {
      // No installed plugins, no standalone servers
      mockReadFile.mockResolvedValue('[]')

      const result = await pluginManager.buildClaudeSdkMcpServers('inst-1')
      expect(result).toEqual({})
    })
  })

  // --- PluginManager method guards ---

  describe('PluginManager guards', () => {
    it('getInstalledPlugins returns empty array when no file exists', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'))

      const plugins = await pluginManager.getInstalledPlugins()
      expect(plugins).toEqual([])
    })

    it('getStandaloneServers returns empty array when no file exists', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'))

      const servers = await pluginManager.getStandaloneServers('inst-1')
      expect(servers).toEqual([])
    })

    it('getMarketplaces returns empty array when no file exists', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'))

      const marketplaces = await pluginManager.getMarketplaces()
      expect(marketplaces).toEqual([])
    })
  })
})

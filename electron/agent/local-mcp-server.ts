import http from 'http'
import type { AddressInfo } from 'net'
import type { FilesystemSandboxPolicy, LoadedSkill } from './types'
import { createFileTools } from './file-tools'
import { jsComputeTool } from './js-sandbox'
import { substituteArguments, readSupportingFile } from '../skill-loader'

// --- Types ---

/** Connection info returned after the local MCP server starts. */
export interface LocalMcpServerInfo {
  /** Full URL to the MCP server endpoint (e.g., http://127.0.0.1:54321) */
  url: string
  /** Port the server is listening on */
  port: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type McpServerInstance = any

// --- Local MCP Server ---

/**
 * Lightweight HTTP MCP server that exposes sandboxed file tools + js_compute
 * for the Claude SDK runner.
 *
 * The Claude SDK only supports MCP servers (not raw LangChain tools), so local
 * tools must be exposed via a localhost MCP server. Each instance is created
 * per-session with the session's sandbox policy baked in.
 *
 * Uses @modelcontextprotocol/sdk to implement the MCP protocol over HTTP.
 * Listens on 127.0.0.1 with a random port (port 0). The server operates in
 * stateless mode — each HTTP request creates a fresh transport.
 *
 * Tools registered:
 * - 13 file format tools (read/write Excel, CSV, PDF, docx, JSON, YAML, text)
 * - js_compute (sandboxed JavaScript execution)
 * - invoke_skill (load skill content by name, when skills are provided)
 * - read_skill_file (read supporting files from a skill directory)
 *
 * None of these tools require human-in-the-loop approval — they are NOT
 * intercepted by the canUseTool callback in ClaudeSdkRunner.
 */
export class LocalMcpServer {
  private httpServer: http.Server | null = null
  private mcpServer: McpServerInstance = null
  private port = 0

  constructor(
    private readonly policy: FilesystemSandboxPolicy,
    private readonly skills: LoadedSkill[] = [],
  ) {}

  /**
   * Start the MCP server on a random localhost port.
   *
   * Lazily imports @modelcontextprotocol/sdk, registers all file tools and
   * js_compute as MCP tools, then starts an HTTP server bound to 127.0.0.1.
   *
   * @returns Server URL and port for inclusion in mcpServers config.
   */
  async start(): Promise<LocalMcpServerInfo> {
    // Lazy import MCP SDK — only loaded when sandbox tools are needed.
    // McpServer is in server/mcp.js (not index.js which only exports the low-level Server).
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    const { StreamableHTTPServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/streamableHttp.js'
    )

    this.mcpServer = new McpServer(
      { name: 'n8n-desk-local', version: '1.0.0' },
      { capabilities: { tools: {} } },
    )

    // Register all 13 file tools + js_compute as MCP tools
    this.registerTools()

    // Create HTTP server that delegates to the MCP transport.
    // Stateless mode: each request gets a fresh transport. The McpServer
    // persists tool registrations and initialization state across transports.
    const mcpRef = this.mcpServer
    this.httpServer = http.createServer(async (req, res) => {
      try {
        // Stateless: create a new transport per request. The McpServer
        // retains its tool registrations across connect() calls — only
        // the I/O channel is swapped.
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        })
        res.on('close', () => {
          transport.close().catch(() => {})
        })
        await mcpRef.connect(transport)
        await transport.handleRequest(req, res)
      } catch {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      }
    })

    // Listen on random port on localhost only (no external access)
    await new Promise<void>((resolve) => {
      this.httpServer!.listen(0, '127.0.0.1', resolve)
    })

    this.port = (this.httpServer!.address() as AddressInfo).port

    return {
      url: `http://127.0.0.1:${this.port}`,
      port: this.port,
    }
  }

  /**
   * Stop the MCP server and close the HTTP listener.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  async stop(): Promise<void> {
    // Close the MCP server first (closes the active transport)
    if (this.mcpServer) {
      try {
        await this.mcpServer.close()
      } catch {
        // Best-effort cleanup
      }
      this.mcpServer = null
    }

    // Close the HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve())
      })
      this.httpServer = null
    }

    this.port = 0
  }

  /**
   * Register LangChain file tools + js_compute as MCP tools on the server.
   *
   * Wraps each LangChain tool: extracts name, description, and Zod schema
   * shape, then registers an MCP handler that calls lcTool.invoke() and
   * returns the result as MCP text content.
   *
   * Error handling: tool invocation errors are returned as isError responses
   * (not thrown) so the agent can recover gracefully.
   */
  private registerTools(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fileTools: any[] = createFileTools(this.policy)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allTools: any[] = [...fileTools, jsComputeTool]

    for (const lcTool of allTools) {
      const name: string = lcTool.name
      const description: string = lcTool.description ?? ''

      // Extract Zod raw shape from the LangChain tool's schema.
      // LangChain's tool() creates DynamicStructuredTool with a z.ZodObject schema.
      // ZodObject.shape gives us the ZodRawShape that McpServer.tool() expects.
      const zodShape = lcTool.schema?.shape

      // Build the MCP tool handler that delegates to the LangChain tool
      const handler = async (args: Record<string, unknown>) => {
        try {
          const result = await lcTool.invoke(args)
          return {
            content: [{
              type: 'text' as const,
              text: typeof result === 'string' ? result : JSON.stringify(result),
            }],
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: false, error: message }),
            }],
            isError: true,
          }
        }
      }

      // Register with Zod schema shape if available (all our tools have schemas)
      if (zodShape) {
        this.mcpServer.tool(name, description, zodShape, handler)
      } else {
        this.mcpServer.tool(name, description, handler)
      }
    }

    // Register skill tools when skills are configured
    this.registerSkillTools()
  }

  /**
   * Register invoke_skill and read_skill_file as MCP tools.
   * These mirror the LangChain tools in DeepAgentsRunner, keeping both
   * agent backends in sync (per CLAUDE.md: both backends must stay in sync).
   */
  private registerSkillTools(): void {
    if (this.skills.length === 0) return

    const { z } = require('zod')
    const skills = this.skills

    // invoke_skill — load skill content by name
    this.mcpServer.tool(
      'invoke_skill',
      'Load a skill by name. Returns the full instructions with arguments substituted. If the content references additional files (e.g., [PATTERNS.md](PATTERNS.md)), use read_skill_file to load them.',
      {
        skillName: z.string().describe('The kebab-case name of the skill to invoke'),
        arguments: z.string().optional().describe('Arguments to substitute into the skill content'),
      },
      async (args: { skillName: string; arguments?: string }) => {
        const skill = skills.find((s) => s.name === args.skillName)
        if (!skill) {
          return {
            content: [{ type: 'text' as const, text: `Skill "${args.skillName}" not found.` }],
            isError: true,
          }
        }
        return {
          content: [{
            type: 'text' as const,
            text: substituteArguments(skill.content, args.arguments ?? ''),
          }],
        }
      },
    )

    // read_skill_file — read supporting files from a skill directory
    this.mcpServer.tool(
      'read_skill_file',
      'Read a supporting file referenced by a skill (e.g., PATTERNS.md, SDK-API.md). Use when invoke_skill returns content that references additional files.',
      {
        skillName: z.string().describe('The skill name that owns this file'),
        filePath: z.string().describe('Relative path within the skill directory (e.g., "PATTERNS.md")'),
      },
      async (args: { skillName: string; filePath: string }) => {
        const skill = skills.find((s) => s.name === args.skillName)
        if (!skill) {
          return {
            content: [{ type: 'text' as const, text: `Skill "${args.skillName}" not found.` }],
            isError: true,
          }
        }
        const content = await readSupportingFile(skill, args.filePath)
        if (content === null) {
          return {
            content: [{ type: 'text' as const, text: `File "${args.filePath}" not found in skill "${args.skillName}".` }],
            isError: true,
          }
        }
        return {
          content: [{ type: 'text' as const, text: content }],
        }
      },
    )
  }
}

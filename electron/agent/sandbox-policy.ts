import path from 'path'
import type { SandboxFolderMount, FilesystemSandboxPolicy } from './types'

// ---------------------------------------------------------------------------
// Deny-lists and allow-lists
// ---------------------------------------------------------------------------

/**
 * File extensions that are always denied for read access regardless of mount.
 * These typically contain secrets, private keys, or encrypted credentials.
 */
export const SENSITIVE_READ_DENY_EXTENSIONS: ReadonlySet<string> = new Set([
  '.env',
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.jks',
  '.keystore',
  '.enc',
])

/**
 * Filenames that are denied for read access ONLY when located under ~/.n8n-desk/.
 * These contain app-internal credentials or configuration that should not be
 * exposed to the agent. The same filenames in user project folders are allowed.
 */
export const SENSITIVE_READ_DENY_N8N_DESK_FILENAMES: ReadonlySet<string> = new Set([
  'credentials.json',
  'tokens.enc',
  'llm.json',
  'auth.json',
])

/**
 * File extensions that are always denied for write access.
 * Prevents the agent from creating executable files on disk.
 */
export const SENSITIVE_WRITE_DENY_EXTENSIONS: ReadonlySet<string> = new Set([
  '.exe',
  '.sh',
  '.bat',
  '.cmd',
  '.app',
  '.dmg',
  '.msi',
  '.dll',
  '.so',
  '.dylib',
])

/**
 * File extensions that are allowed for write operations.
 * Only files with these extensions can be written by the agent.
 * This is an allowlist — any extension not listed here is denied.
 */
export const WRITABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.md',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.txt',
  '.js',
  '.ts',
  '.vue',
  '.scss',
  '.css',
  '.html',
  '.xml',
  '.csv',
  '.toml',
  '.svg',
  '.xlsx',
  '.docx',
])

// ---------------------------------------------------------------------------
// Policy builders
// ---------------------------------------------------------------------------

/**
 * Shared folder mount structure for user-attached folders.
 * Maps each attached folder as a read-write mount under /workspace/.
 */
function buildAttachedFolderMounts(
  attachedFolders: Array<{ path: string }>,
): SandboxFolderMount[] {
  return attachedFolders.map((folder, index) => {
    const basename = path.basename(folder.path)
    // Use index suffix to avoid collisions when multiple folders share the same basename
    const prefix = attachedFolders.length > 1
      ? `/workspace/${basename}-${index}/`
      : `/workspace/${basename}/`

    return {
      hostPath: path.resolve(folder.path),
      virtualPrefix: prefix,
      mode: 'rw' as const,
    }
  })
}

/**
 * Build a filesystem sandbox policy for Cowork mode sessions.
 *
 * Mounts:
 * - Each user-attached folder as read-write under /workspace/
 * - ~/.n8n-desk/skills/ as read-write (agent can create/edit skills)
 * - ~/.n8n-desk/ as read-only (minus sensitive files, enforced by sandbox-filter)
 *
 * @param attachedFolders - Folders the user attached to this session
 * @param n8nDeskDir - Absolute path to ~/.n8n-desk/
 */
export function buildCoworkPolicy(
  attachedFolders: Array<{ path: string }>,
  n8nDeskDir: string,
): FilesystemSandboxPolicy {
  const resolvedN8nDeskDir = path.resolve(n8nDeskDir)

  const mounts: SandboxFolderMount[] = [
    // User-attached folders (read-write)
    ...buildAttachedFolderMounts(attachedFolders),

    // Skills directory is always writable
    {
      hostPath: path.join(resolvedN8nDeskDir, 'skills'),
      virtualPrefix: '/n8n-desk/skills/',
      mode: 'rw',
    },

    // ~/.n8n-desk/ is readable (sensitive files filtered by sandbox-filter)
    {
      hostPath: resolvedN8nDeskDir,
      virtualPrefix: '/n8n-desk/',
      mode: 'ro',
    },
  ]

  return {
    mounts,
    n8nDeskDir: resolvedN8nDeskDir,
  }
}

/**
 * Build a filesystem sandbox policy for Workflow mode sessions.
 *
 * Workflow mode primarily uses MCP CRUD tools, but may need file access
 * for reading workflow SDK code from attached folders or writing generated
 * artifacts.
 *
 * Mounts:
 * - Each user-attached folder as read-write under /workspace/
 * - ~/.n8n-desk/skills/ as read-write
 * - ~/.n8n-desk/ as read-only (minus sensitive files, enforced by sandbox-filter)
 *
 * @param attachedFolders - Folders the user attached to this session
 * @param n8nDeskDir - Absolute path to ~/.n8n-desk/
 */
export function buildWorkflowPolicy(
  attachedFolders: Array<{ path: string }>,
  n8nDeskDir: string,
): FilesystemSandboxPolicy {
  const resolvedN8nDeskDir = path.resolve(n8nDeskDir)

  const mounts: SandboxFolderMount[] = [
    // User-attached folders (read-write)
    ...buildAttachedFolderMounts(attachedFolders),

    // Skills directory is always writable
    {
      hostPath: path.join(resolvedN8nDeskDir, 'skills'),
      virtualPrefix: '/n8n-desk/skills/',
      mode: 'rw',
    },

    // ~/.n8n-desk/ is readable (sensitive files filtered by sandbox-filter)
    {
      hostPath: resolvedN8nDeskDir,
      virtualPrefix: '/n8n-desk/',
      mode: 'ro',
    },
  ]

  return {
    mounts,
    n8nDeskDir: resolvedN8nDeskDir,
  }
}

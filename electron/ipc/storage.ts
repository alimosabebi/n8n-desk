import { ipcMain } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

const BASE_DIR = path.join(os.homedir(), '.n8n-desk')

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true, mode: 0o700 })
}

export function registerStorageHandlers(): void {
  ipcMain.handle('storage:read', async (_event, relativePath: string) => {
    try {
      const fullPath = path.join(BASE_DIR, relativePath)
      const content = await fs.readFile(fullPath, 'utf-8')
      return content
    } catch {
      return null
    }
  })

  ipcMain.handle('storage:write', async (_event, relativePath: string, data: string) => {
    const fullPath = path.join(BASE_DIR, relativePath)
    await ensureDir(path.dirname(fullPath))
    await fs.writeFile(fullPath, data, { encoding: 'utf-8', mode: 0o600 })
  })

  ipcMain.handle('storage:append', async (_event, relativePath: string, line: string) => {
    const fullPath = path.join(BASE_DIR, relativePath)
    await ensureDir(path.dirname(fullPath))
    await fs.appendFile(fullPath, line + '\n', { encoding: 'utf-8', mode: 0o600 })
  })
}

import { ipcMain, BrowserWindow } from 'electron'
import WebSocket from 'ws'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { safeStorage } from 'electron'

const BASE_DIR = path.join(os.homedir(), '.n8n-desk')

let activeWs: WebSocket | null = null
let heartbeatInterval: ReturnType<typeof setInterval> | null = null
let handlersRegistered = false

async function readSessionToken(instanceId: string): Promise<string | null> {
  try {
    const filePath = path.join(BASE_DIR, 'instances', instanceId, 'session.enc')
    const data = await fs.readFile(filePath)

    let jsonStr: string
    if (safeStorage.isEncryptionAvailable()) {
      jsonStr = safeStorage.decryptString(data)
    } else {
      jsonStr = data.toString('utf-8')
    }

    const parsed = JSON.parse(jsonStr) as { session_token: string }
    return parsed.session_token
  } catch {
    return null
  }
}

function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval)
    heartbeatInterval = null
  }
}

function startHeartbeat(): void {
  stopHeartbeat()
  heartbeatInterval = setInterval(() => {
    if (activeWs && activeWs.readyState === WebSocket.OPEN) {
      activeWs.send(JSON.stringify({ type: 'heartbeat' }))
    }
  }, 30000)
}

export function registerPushProxyHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  /**
   * Open a WebSocket to n8n's /rest/push endpoint from the main process.
   * The session cookie is sent as a header (no CORS/SameSite issues).
   * All received messages are forwarded to the renderer via 'push:event'.
   */
  ipcMain.handle(
    'push:connect',
    async (_event, instanceId: string, instanceUrl: string): Promise<{ success: boolean; error?: string }> => {
      // Close any existing connection
      if (activeWs) {
        activeWs.removeAllListeners()
        activeWs.close()
        activeWs = null
        stopHeartbeat()
      }

      const sessionToken = await readSessionToken(instanceId)
      if (!sessionToken) {
        return { success: false, error: 'No session token' }
      }

      const pushRef = crypto.randomUUID()
      const wsUrl = `${instanceUrl.replace(/^http/, 'ws')}/rest/push?pushRef=${pushRef}`

      return new Promise((resolve) => {
        const ws = new WebSocket(wsUrl, {
          headers: {
            Cookie: `n8n-auth=${sessionToken}`,
            Origin: instanceUrl,
          },
        })

        const timeout = setTimeout(() => {
          ws.removeAllListeners()
          ws.close()
          resolve({ success: false, error: 'Connection timeout' })
        }, 10000)

        ws.on('open', () => {
          clearTimeout(timeout)
          activeWs = ws
          startHeartbeat()

          const win = BrowserWindow.getAllWindows()[0]
          if (win) {
            win.webContents.send('push:status', 'connected')
          }

          resolve({ success: true })
        })

        ws.on('message', (data: WebSocket.Data) => {
          const win = BrowserWindow.getAllWindows()[0]
          if (!win) return

          const raw = typeof data === 'string' ? data : data.toString('utf-8')
          win.webContents.send('push:event', raw)
        })

        ws.on('close', () => {
          stopHeartbeat()
          const win = BrowserWindow.getAllWindows()[0]
          if (win) {
            win.webContents.send('push:status', 'disconnected')
          }
          if (activeWs === ws) {
            activeWs = null
          }
        })

        ws.on('error', (err) => {
          clearTimeout(timeout)
          console.error('[PushProxy] WebSocket error:', err.message)
          const win = BrowserWindow.getAllWindows()[0]
          if (win) {
            win.webContents.send('push:status', 'reconnecting')
          }
        })
      })
    },
  )

  ipcMain.handle('push:disconnect', async (): Promise<void> => {
    stopHeartbeat()
    if (activeWs) {
      activeWs.removeAllListeners()
      activeWs.close()
      activeWs = null
    }
  })
}

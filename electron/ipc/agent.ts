import { ipcMain, BrowserWindow } from 'electron'

export function registerAgentHandlers(_mainWindow: BrowserWindow): void {
  ipcMain.handle('agent:invoke', async (_event, _sessionId: string, _message: string) => {
    return { error: 'not implemented' }
  })

  ipcMain.handle('agent:stop', async (_event, _sessionId: string) => {
    return { error: 'not implemented' }
  })

  ipcMain.handle('agent:approve', async (_event, _sessionId: string, _decision: 'approve' | 'reject') => {
    return { error: 'not implemented' }
  })
}

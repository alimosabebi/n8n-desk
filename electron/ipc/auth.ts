import { ipcMain } from 'electron'

export function registerAuthHandlers(): void {
  ipcMain.handle('auth:login', async (_event, _instanceUrl: string) => {
    return { error: 'not implemented' }
  })

  ipcMain.handle('auth:logout', async () => {
    return { error: 'not implemented' }
  })

  ipcMain.handle('auth:refresh', async () => {
    return { error: 'not implemented' }
  })
}

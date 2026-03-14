import { ipcMain } from 'electron'

export function registerKeychainHandlers(): void {
  ipcMain.handle('keychain:get', async (_event, _key: string) => {
    return { error: 'not implemented' }
  })

  ipcMain.handle('keychain:set', async (_event, _key: string, _value: string) => {
    return { error: 'not implemented' }
  })

  ipcMain.handle('keychain:delete', async (_event, _key: string) => {
    return { error: 'not implemented' }
  })
}

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('n8nDesk', {
  agent: {
    invoke: (sessionId: string, message: string) =>
      ipcRenderer.invoke('agent:invoke', sessionId, message),
    stop: (sessionId: string) =>
      ipcRenderer.invoke('agent:stop', sessionId),
    approve: (sessionId: string, decision: 'approve' | 'reject') =>
      ipcRenderer.invoke('agent:approve', sessionId, decision),
    onEvent: (callback: (event: unknown) => void) => {
      ipcRenderer.on('agent:event', (_event, data) => callback(data))
    },
  },
  storage: {
    read: (path: string) =>
      ipcRenderer.invoke('storage:read', path),
    write: (path: string, data: string) =>
      ipcRenderer.invoke('storage:write', path, data),
    append: (path: string, line: string) =>
      ipcRenderer.invoke('storage:append', path, line),
  },
  auth: {
    login: (instanceUrl: string) =>
      ipcRenderer.invoke('auth:login', instanceUrl),
    logout: () =>
      ipcRenderer.invoke('auth:logout'),
    refresh: () =>
      ipcRenderer.invoke('auth:refresh'),
  },
  keychain: {
    get: (key: string) =>
      ipcRenderer.invoke('keychain:get', key),
    set: (key: string, value: string) =>
      ipcRenderer.invoke('keychain:set', key, value),
    delete: (key: string) =>
      ipcRenderer.invoke('keychain:delete', key),
  },
})

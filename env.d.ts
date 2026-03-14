/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

interface N8nDeskBridge {
  agent: {
    invoke: (sessionId: string, message: string) => Promise<unknown>
    stop: (sessionId: string) => Promise<void>
    approve: (sessionId: string, decision: 'approve' | 'reject') => Promise<void>
    onEvent: (callback: (event: unknown) => void) => void
  }
  storage: {
    read: (path: string) => Promise<string | null>
    write: (path: string, data: string) => Promise<void>
    append: (path: string, line: string) => Promise<void>
  }
  auth: {
    login: (instanceUrl: string) => Promise<unknown>
    logout: () => Promise<void>
    refresh: () => Promise<unknown>
  }
  keychain: {
    get: (key: string) => Promise<string | null>
    set: (key: string, value: string) => Promise<void>
    delete: (key: string) => Promise<void>
  }
}

interface Window {
  n8nDesk?: N8nDeskBridge
}

export type ThemeMode = 'light' | 'dark' | 'system'
export type AppMode = 'chat' | 'cowork' | 'workflow'

export interface AppSettings {
  theme: ThemeMode
  defaultInstanceId: string | null
  lastMode: AppMode
}

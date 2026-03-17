export type ThemeMode = 'light' | 'dark' | 'system'
export type AppMode = 'chat' | 'cowork' | 'workflow'
export type SupportedLocale = 'en'

export interface AppSettings {
  theme: ThemeMode
  defaultInstanceId: string | null
  lastMode: AppMode
  locale: SupportedLocale
}

// --- Agent Backend ---

export type AgentBackend = 'claude-sdk' | 'deep-agents'

// --- LLM Provider ---

export type LlmProvider = 'anthropic' | 'openai' | 'ollama'

export interface ClaudeSdkConfig {
  backend: 'claude-sdk'
  apiKey: string
  model: string
}

export interface DeepAgentsConfig {
  backend: 'deep-agents'
  provider: LlmProvider
  model: string
  apiKey?: string
  ollamaBaseUrl?: string
}

export type LlmConfig = ClaudeSdkConfig | DeepAgentsConfig

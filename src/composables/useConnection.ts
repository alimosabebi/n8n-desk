import { ref, computed } from 'vue'
import type { ConnectionStatus } from '@/types/connection'

/** WebSocket-specific connection status */
export type WsStatus = 'connected' | 'reconnecting' | 'disconnected'

/**
 * Fetch that bypasses CORS by routing through Electron's main process.
 */
async function healthFetch(url: string): Promise<boolean> {
  try {
    if (window.n8nDesk) {
      const result = await window.n8nDesk.api.fetch(url, { method: 'GET', timeoutMs: 5000 })
      return result.status >= 200 && result.status < 300
    }
    // Fallback for browser (will hit CORS in dev — acceptable)
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
    return response.ok
  } catch {
    return false
  }
}

// --- Shared singleton state ---
const healthStatus = ref<ConnectionStatus>('disconnected')
const wsStatus = ref<WsStatus>('disconnected')
const lastChecked = ref<string | null>(null)

let healthInterval: ReturnType<typeof setInterval> | null = null
let currentBaseUrl: string | null = null
let listenersBound = false

/**
 * Combined status — use health status as primary indicator.
 * WebSocket status only downgrades if it was previously connected (i.e., it's actually in use).
 */
const status = computed<ConnectionStatus>(() => {
  // If health check passes, we're connected (WebSocket may not be in use yet)
  return healthStatus.value
})

async function performCheck(): Promise<void> {
  if (!currentBaseUrl) return
  if (document.hidden) return

  const reachable = await healthFetch(`${currentBaseUrl}/healthz`)
  lastChecked.value = new Date().toISOString()

  if (reachable) {
    healthStatus.value = 'connected'
  } else if (healthStatus.value === 'connected') {
    healthStatus.value = 'reconnecting'
  } else {
    healthStatus.value = 'disconnected'
  }
}

function handleOnline(): void {
  if (currentBaseUrl) {
    healthStatus.value = 'reconnecting'
    void performCheck()
  }
}

function handleOffline(): void {
  healthStatus.value = 'disconnected'
}

function handleVisibilityChange(): void {
  if (!document.hidden && currentBaseUrl) {
    void performCheck()
  }
}

function bindListeners(): void {
  if (listenersBound) return
  listenersBound = true
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  document.addEventListener('visibilitychange', handleVisibilityChange)
}

export function useConnection() {
  // Bind global listeners once on first use
  bindListeners()

  async function checkHealth(baseUrl: string): Promise<boolean> {
    return healthFetch(`${baseUrl}/healthz`)
  }

  function setWsStatus(newStatus: WsStatus): void {
    wsStatus.value = newStatus
  }

  function startMonitoring(baseUrl: string): void {
    stopMonitoring()
    currentBaseUrl = baseUrl

    // Initial check
    void performCheck()

    // Poll every 30 seconds
    healthInterval = setInterval(() => {
      void performCheck()
    }, 30000)
  }

  function stopMonitoring(): void {
    if (healthInterval) {
      clearInterval(healthInterval)
      healthInterval = null
    }
    currentBaseUrl = null
    healthStatus.value = 'disconnected'
    wsStatus.value = 'disconnected'
  }

  return {
    status,
    healthStatus,
    wsStatus,
    lastChecked,
    startMonitoring,
    stopMonitoring,
    checkHealth,
    setWsStatus,
  }
}

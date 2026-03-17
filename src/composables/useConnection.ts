import { ref, computed, onMounted, onUnmounted } from 'vue'
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

/** Priority order for picking the worst status */
const STATUS_PRIORITY: Record<ConnectionStatus, number> = {
  disconnected: 0,
  reconnecting: 1,
  connected: 2,
}

export function useConnection() {
  const healthStatus = ref<ConnectionStatus>('disconnected')
  const wsStatus = ref<WsStatus>('disconnected')
  const lastChecked = ref<string | null>(null)

  /** Combined status — reflects the worst of health + WebSocket sources */
  const status = computed<ConnectionStatus>(() => {
    const healthPri = STATUS_PRIORITY[healthStatus.value]
    const wsPri = STATUS_PRIORITY[wsStatus.value]
    const worst = Math.min(healthPri, wsPri)
    return (Object.entries(STATUS_PRIORITY) as [ConnectionStatus, number][])
      .find(([, v]) => v === worst)![0]
  })

  let healthInterval: ReturnType<typeof setInterval> | null = null
  let currentBaseUrl: string | null = null

  async function checkHealth(baseUrl: string): Promise<boolean> {
    return healthFetch(`${baseUrl}/healthz`)
  }

  async function performCheck(): Promise<void> {
    if (!currentBaseUrl) return

    // Skip if document is hidden (save resources)
    if (document.hidden) return

    const reachable = await checkHealth(currentBaseUrl)
    lastChecked.value = new Date().toISOString()

    if (reachable) {
      healthStatus.value = 'connected'
    } else if (healthStatus.value === 'connected') {
      healthStatus.value = 'reconnecting'
    } else {
      healthStatus.value = 'disconnected'
    }
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

  // Listen to browser online/offline events for fast hints
  function handleOnline(): void {
    if (currentBaseUrl) {
      healthStatus.value = 'reconnecting'
      void performCheck()
    }
  }

  function handleOffline(): void {
    healthStatus.value = 'disconnected'
  }

  // Resume polling when tab becomes visible
  function handleVisibilityChange(): void {
    if (!document.hidden && currentBaseUrl) {
      void performCheck()
    }
  }

  onMounted(() => {
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    document.addEventListener('visibilitychange', handleVisibilityChange)
  })

  onUnmounted(() => {
    stopMonitoring()
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  })

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

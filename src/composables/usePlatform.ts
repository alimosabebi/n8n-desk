import { computed } from 'vue'
import { Capacitor } from '@capacitor/core'

export function usePlatform() {
  const isNative = computed(() => {
    try {
      return Capacitor.isNativePlatform()
    } catch {
      return false
    }
  })

  const isMobile = computed(() => {
    if (isNative.value) return true
    // Fallback: check viewport width for web dev
    return typeof window !== 'undefined' && window.innerWidth < 768
  })

  const isDesktop = computed(() => !isMobile.value)

  const isElectron = computed(() => {
    return typeof window !== 'undefined' && window.n8nDesk !== undefined
  })

  const platform = computed(() => {
    if (isElectron.value) return 'electron' as const
    if (isNative.value) return 'capacitor' as const
    return 'web' as const
  })

  return { isNative, isMobile, isDesktop, isElectron, platform }
}

import type { ThemeMode } from '@/types/settings'

let mediaQuery: MediaQueryList | null = null
let mediaListener: ((e: MediaQueryListEvent) => void) | null = null

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function setBodyTheme(resolved: 'light' | 'dark') {
  document.body.setAttribute('data-theme', resolved)
}

export function useTheme() {
  function applyTheme(mode: ThemeMode) {
    // Clean up previous listener
    if (mediaQuery && mediaListener) {
      mediaQuery.removeEventListener('change', mediaListener)
      mediaListener = null
    }

    if (mode === 'system') {
      setBodyTheme(getSystemTheme())
      mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      mediaListener = (e: MediaQueryListEvent) => {
        setBodyTheme(e.matches ? 'dark' : 'light')
      }
      mediaQuery.addEventListener('change', mediaListener)
    } else {
      setBodyTheme(mode)
    }
  }

  function init(mode: ThemeMode) {
    applyTheme(mode)
  }

  return { applyTheme, init }
}

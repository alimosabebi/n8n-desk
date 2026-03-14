import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { UserRole } from '@/types/auth'

export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(null)
  const userRole = ref<UserRole>('unknown')
  const scopes = ref<string[]>([])
  const expiresAt = ref<string | null>(null)

  const isAuthenticated = computed(() => accessToken.value !== null)
  const isFullAccess = computed(() => userRole.value !== 'chatUser' && userRole.value !== 'unknown')

  async function hydrate(): Promise<void> {
    // TODO: Load token metadata from auth.json, actual tokens from keychain
  }

  function reset(): void {
    accessToken.value = null
    userRole.value = 'unknown'
    scopes.value = []
    expiresAt.value = null
  }

  function setTokens(token: string, refresh: string, role: UserRole, tokenScopes: string[], expires: string): void {
    accessToken.value = token
    userRole.value = role
    scopes.value = tokenScopes
    expiresAt.value = expires
    // refresh token goes to keychain, not stored here
    void refresh // used by caller for keychain storage
  }

  async function clearTokens(): Promise<void> {
    reset()
    // TODO: Clear keychain
  }

  return {
    accessToken,
    userRole,
    scopes,
    expiresAt,
    isAuthenticated,
    isFullAccess,
    hydrate,
    reset,
    setTokens,
    clearTokens,
  }
})

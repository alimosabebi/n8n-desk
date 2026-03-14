export type UserRole = 'owner' | 'admin' | 'member' | 'chatUser' | 'unknown'

export interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  userRole: UserRole
  scopes: string[]
  expiresAt: string | null
}

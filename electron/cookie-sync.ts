import { session } from 'electron'

/**
 * Sync an n8n-auth cookie into Chromium's cookie store so that WebSocket
 * upgrade requests (which bypass the api:fetch IPC proxy) include the
 * session cookie automatically.
 */
export async function syncCookieToChromium(instanceUrl: string, sessionToken: string): Promise<void> {
  const parsed = new URL(instanceUrl)
  const isSecure = parsed.protocol === 'https:'

  await session.defaultSession.cookies.set({
    url: instanceUrl,
    name: 'n8n-auth',
    value: sessionToken,
    path: '/',
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
  })
}

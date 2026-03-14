import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.n8ndesk.app',
  appName: 'n8n-desk',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    App: {
      url: 'n8ndesk://callback',
    },
  },
}

export default config

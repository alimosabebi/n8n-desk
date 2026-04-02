import type { ForgeConfig } from '@electron-forge/shared-types'
import { MakerZIP } from '@electron-forge/maker-zip'

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'n8n-desk',
    extraResource: ['skills/plugins'],
  },
  makers: [
    new MakerZIP({}, ['darwin', 'linux', 'win32']),
  ],
}

export default config

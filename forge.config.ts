import type { ForgeConfig } from '@electron-forge/shared-types'
import { MakerZIP } from '@electron-forge/maker-zip'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerAppImage } from '@electron-forge/maker-appimage'

const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'
const isLinux = process.platform === 'linux'

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'n8n-desk',
    executableName: 'n8n-desk',
    appBundleId: 'com.n8n-desk.app',
    extraResource: ['skills/plugins'],
    // TODO: add `icon` once branded .icns/.ico/.png assets land
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin', 'linux', 'win32']),
  ],
}

export default config

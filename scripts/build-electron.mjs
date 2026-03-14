import { writeFileSync, mkdirSync } from 'fs'
import { execSync } from 'child_process'

// Compile Electron TypeScript with tsc
execSync('tsc -p tsconfig.electron.json', { stdio: 'inherit' })

// Add a package.json to the output dir that forces CJS mode,
// overriding the root "type": "module" for Electron's main process
mkdirSync('electron/dist', { recursive: true })
writeFileSync('electron/dist/package.json', JSON.stringify({ type: 'commonjs' }))

console.log('Electron build complete')

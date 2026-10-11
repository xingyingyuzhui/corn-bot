import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const root = dirname(require.resolve('electron/package.json'))
const child = spawn(process.execPath, [join(root, 'install.js')], {
  stdio: 'inherit',
})
child.once('error', (error) => {
  console.error(error.message)
  process.exitCode = 1
})
child.once('close', (code) => {
  process.exitCode = code ?? 1
})

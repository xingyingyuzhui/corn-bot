import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateAppIcons } from './lib/app-icons.mjs'

// macOS App icon from the locked source PNG. Run: pnpm icons:mac
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const { icns, hashes } = await generateAppIcons(root)
for (const [file, hash] of Object.entries(hashes))
  console.log(`${hash}  ${file}`)
console.log(`App icon written to ${icns}`)

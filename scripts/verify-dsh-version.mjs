import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const lock = JSON.parse(
  await readFile(new URL('../runtime.lock.json', import.meta.url), 'utf8'),
)
const installed = require('@deepseek-ai/dsh/package.json')
if (installed.version !== lock.dsh.version)
  throw new Error('DSH runtime version mismatch')
console.log(
  JSON.stringify({
    verified: true,
    dshVersion: installed.version,
    contractCommit: lock.dsh.commit,
  }),
)

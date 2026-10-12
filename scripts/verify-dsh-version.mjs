import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { isDeepStrictEqual } from 'node:util'
import {
  DSH_PATCHES,
  verifyDshPatches,
} from '../apps/desktop/src/runtime/dsh-patch.ts'

const require = createRequire(import.meta.url)
const lock = JSON.parse(
  await readFile(new URL('../runtime.lock.json', import.meta.url), 'utf8'),
)
const installed = require('@deepseek-ai/dsh/package.json')
if (installed.version !== lock.dsh.version)
  throw new Error('DSH runtime version mismatch')
if (!isDeepStrictEqual(lock.dshPatches, DSH_PATCHES))
  throw new Error('runtime.lock.json dshPatches differ from DSH_PATCHES')
for (const patch of DSH_PATCHES) {
  const digest = createHash('sha256')
    .update(await readFile(new URL(`../${patch.patch}`, import.meta.url)))
    .digest('hex')
  if (digest !== patch.sha256)
    throw new Error(`DSH patch ${patch.id} file differs from the lock`)
}
await verifyDshPatches(require.resolve('@deepseek-ai/dsh/package.json'))
console.log(
  JSON.stringify({
    verified: true,
    dshVersion: installed.version,
    contractCommit: lock.dsh.commit,
    dshPatches: DSH_PATCHES.map(({ id, sha256 }) => ({ id, sha256 })),
  }),
)

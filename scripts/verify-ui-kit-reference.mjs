import { fileURLToPath } from 'node:url'
import { verifyUiKitReference } from './lib/ui-kit-reference.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const strict =
  process.argv.includes('--strict') || process.env.CORN_UI_KIT_STRICT === '1'

const report = await verifyUiKitReference({
  repoRoot,
  kitDirOverride: process.env.CORN_UI_KIT_DIR,
})
console.log(JSON.stringify(report, null, 2))

if (report.status === 'failed') process.exitCode = 1
if (report.status === 'skipped' && strict) process.exitCode = 1

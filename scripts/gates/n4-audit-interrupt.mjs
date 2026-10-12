import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import {
  assertSandboxDeniesNetwork,
  descendants,
  dshHosts,
  gitCommit,
  processTable,
  sandboxedSpawn,
  writeReport,
} from './lib/gate-env.mjs'

// Run: node scripts/gates/run.mjs scripts/gates/n4-audit-interrupt.mjs -- <phase> <SIGINT|SIGTERM>
// phase: template-host | template-install | audit-host
// Interrupts a real `model-config-api-audit` (real template build, real Hosts)
// at the chosen phase and checks N4: status `interrupted`, exit 128+signal,
// no owned process, lab or template home left.
const [phase, signal] = process.argv.slice(2)
assert.ok(['template-host', 'template-install', 'audit-host'].includes(phase))
assert.ok(['SIGINT', 'SIGTERM'].includes(signal))
const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const reportPath = join(repo, '.artifacts', 'model-config-api-audit.json')
const TEMP_PREFIXES = ['corn-audit-api-', 'corn-profile-template-']

await assertSandboxDeniesNetwork()
const tempEntries = async () =>
  (await readdir(tmpdir())).filter((name) =>
    TEMP_PREFIXES.some((prefix) => name.startsWith(prefix)),
  )
const tempBefore = await tempEntries()
const env = { ...process.env }
delete env.CORN_DSH_HOME
const started = Date.now()
// The audit and everything it spawns run under the no-network sandbox.
const child = sandboxedSpawn(
  process.execPath,
  [join(repo, 'scripts', 'audit', 'model-config-api-audit.mjs')],
  { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] },
)
let output = ''
child.stdout.setEncoding('utf8').on('data', (text) => {
  output = (output + text).slice(-8_000)
})
child.stderr.setEncoding('utf8').on('data', (text) => {
  output = (output + text).slice(-8_000)
})
const exited = new Promise((resolve) =>
  child.once('close', (code, sig) => resolve({ code, signal: sig })),
)

function matches(row) {
  const host = row.command.includes('/dsh/lib/bin.js')
  const template = row.command.includes('corn-profile-template-')
  if (phase === 'template-host') return host && template
  if (phase === 'template-install')
    return (
      row.command.includes('install-desktop-local.mjs') ||
      (row.command.includes('pnpm') && row.command.includes('install'))
    )
  return host && row.command.includes('corn-audit-api-') && !template
}

let trigger
const tracked = new Map()
const deadline = Date.now() + 90_000
while (!trigger && Date.now() < deadline) {
  const tree = descendants(await processTable(), child.pid).filter(
    (row) => row.pid !== child.pid,
  )
  for (const row of tree) tracked.set(row.pid, row.command.slice(0, 140))
  const hit = tree.find(matches)
  if (hit) trigger = { pid: hit.pid, command: hit.command.slice(0, 140) }
  else if (child.exitCode !== null) break
  else await delay(20)
}
if (!trigger) {
  // Never leave the audit behind: an unobserved phase ends the run, bounded.
  if (child.exitCode === null) {
    child.kill('SIGTERM')
    if (
      (await Promise.race([
        exited,
        delay(30_000, undefined, { ref: false }),
      ])) === undefined
    )
      child.kill('SIGKILL')
  }
  throw new Error(`Phase ${phase} never observed before the audit ended`)
}
if (phase === 'audit-host') await delay(1_500)
const signalledAt = Date.now()
const treeAtSignal = descendants(await processTable(), child.pid)
  .filter((row) => row.pid !== child.pid)
  .map((row) => ({ pid: row.pid, command: row.command.slice(0, 140) }))
for (const row of treeAtSignal) tracked.set(row.pid, row.command)
child.kill(signal)
const bound = await Promise.race([
  exited,
  delay(60_000, undefined, { ref: false }).then(() => 'hang'),
])
if (bound === 'hang') {
  child.kill('SIGKILL')
  throw new Error('Interrupted audit did not exit within 60 s')
}
await delay(1_000)
const table = await processTable()
const survivors = [...tracked.keys()].filter((pid) =>
  table.some((row) => row.pid === pid),
)
const tempAfter = (await tempEntries()).filter(
  (name) => !tempBefore.includes(name),
)
const report = JSON.parse(await readFile(reportPath, 'utf8'))
const expectedExit = signal === 'SIGINT' ? 130 : 143
const result = {
  scenario: 'A3 N4 interrupted audit',
  phase,
  signal,
  commit: await gitCommit(),
  real: 'real audit script, real template build (locked DSH, SHA-checked Claw release, pnpm offline under sandbox), real Hosts',
  trigger,
  treeAtSignal,
  timeToSignalMs: signalledAt - started,
  exitMs: Date.now() - signalledAt - 1_000,
  exit: bound,
  report: {
    status: report.status,
    interrupted: report.interrupted,
    cleanup: report.cleanup,
    problems: report.problems,
  },
  survivors,
  newTempEntries: tempAfter,
  hostsAliveAfter: (await dshHosts()).map((row) => row.pid),
}
result.passed =
  bound.code === expectedExit &&
  report.status === 'interrupted' &&
  report.interrupted === signal &&
  survivors.length === 0 &&
  tempAfter.length === 0 &&
  result.hostsAliveAfter.length === 0
await writeReport(`a3-n4-${phase}-${signal}`, result)
console.log(JSON.stringify(result, null, 2))
if (!result.passed) {
  console.error(
    `N4 ${phase}/${signal} FAILED; audit tail:\n${output.slice(-2_000)}`,
  )
  process.exit(1)
}

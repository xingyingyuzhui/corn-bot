import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import {
  assertHomeReleased,
  assertSandboxDeniesNetwork,
  createRunHome,
  descendants,
  gitCommit,
  governedHost,
  processTable,
  removeRunHome,
  sandboxedSpawn,
  writeReport,
} from './lib/gate-env.mjs'

// Run: node scripts/gates/run.mjs scripts/gates/a4-bounded-stop.mjs
// #19 bounded stop against a real governed Host whose process ignores SIGTERM
// (support/ignore-sigterm.mjs preload). The supervisor and its production
// timeouts (8 s grace, 5 s kill bound) are unchanged.
const preload = new URL('./support/ignore-sigterm.mjs', import.meta.url).href
await assertSandboxDeniesNetwork()
const home = await createRunHome('a4-bounded-stop')
const host = governedHost(home, {
  spawnHost: (command, args, options) =>
    sandboxedSpawn(command, ['--import', preload, ...args], options),
})
const alive = async (pid) =>
  (await processTable()).some((row) => row.pid === pid)

async function boundedStop(round) {
  await host.start()
  const pid = host.processId
  assert.ok(pid)
  const tree = descendants(await processTable(), pid).map((row) => row.pid)
  const started = Date.now()
  const timeline = []
  let settled
  const stopping = host.stop().then(
    () => {
      settled = { ok: true, ms: Date.now() - started }
    },
    (error) => {
      settled = { ok: false, ms: Date.now() - started, error: error.name }
    },
  )
  while (!settled && Date.now() - started < 20_000) {
    timeline.push({ ms: Date.now() - started, alive: await alive(pid) })
    await delay(500)
  }
  await stopping
  const table = await processTable()
  const survivors = tree.filter((item) => table.some((row) => row.pid === item))
  const aliveDuringGrace = timeline
    .filter((row) => row.ms < 7_500)
    .every((row) => row.alive)
  return {
    round,
    pid,
    processTree: tree.length,
    stop: settled,
    aliveDuringGrace,
    firstDeadMs: timeline.find((row) => !row.alive)?.ms ?? null,
    survivors,
    running: host.running,
  }
}

let result
try {
  const rounds = [await boundedStop(1), await boundedStop(2)]
  const released = await assertHomeReleased(home)
  result = {
    scenario: 'A4 #19 bounded stop, SIGTERM-ignoring real Host',
    commit: await gitCommit(),
    real: 'real DSH CLI Host, real profile, governed admission, production DshHostSupervisor timeouts; only a Node --import preload swallowing SIGTERM was added',
    rounds,
    released,
  }
  result.passed =
    rounds.every(
      (r) =>
        r.stop.ok &&
        r.aliveDuringGrace &&
        r.stop.ms >= 8_000 &&
        r.stop.ms <= 8_000 + 5_000 + 5_000 &&
        r.survivors.length === 0 &&
        !r.running,
    ) && released.ok
} finally {
  await host.stop().catch(() => {})
}
await writeReport('a4-bounded-stop', result)
console.log(JSON.stringify(result, null, 2))
if (result.passed) await removeRunHome(home)
else process.exit(1)

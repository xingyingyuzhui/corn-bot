import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DshHostSupervisor } from '../apps/desktop/src/runtime/dsh-host-supervisor.ts'
import { SessionClient } from '../packages/dsh-adapter/src/session-client.ts'
import { HostTransport } from '../packages/dsh-adapter/src/transport.ts'

// Empty, disposable homes; no profile, settings, model key or Claw import.
for (let round = 1; round <= 3; round++) {
  const home = await mkdtemp(join(tmpdir(), 'corn-cold-start-'))
  const host = new DshHostSupervisor(home, undefined, null)
  try {
    const auth = await host.start()
    await new SessionClient(new HostTransport(auth)).list()
    await Promise.all(Array.from({ length: 5 }, () => host.stop()))
    await assert.rejects(
      fetch(auth.origin, { signal: AbortSignal.timeout(2_000) }),
    )
    console.log(`PASS isolated DSH cold start ${round}/3 and concurrent stop`)
  } finally {
    await host.stop()
    await rm(home, { recursive: true, force: true })
  }
}

const home = await mkdtemp(join(tmpdir(), 'corn-early-stop-'))
const host = new DshHostSupervisor(home, undefined, null)
try {
  const startup = host.start()
  await assert.rejects(host.start(), /already started/u)
  const stopped = host.stop()
  const auth = await startup
  await stopped
  await assert.rejects(
    fetch(auth.origin, { signal: AbortSignal.timeout(2_000) }),
  )
  console.log('PASS stop during startup waits and releases its owned Host')
} finally {
  await host.stop()
  await rm(home, { recursive: true, force: true })
}
console.log(
  'Scope: DSH baseline cold boot only; full Claw cold boot remains separate.',
)

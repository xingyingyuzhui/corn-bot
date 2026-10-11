import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBootstrapHost } from '../apps/desktop/src/runtime/host-bootstrap.ts'
import { HostStoppedError } from '../apps/desktop/src/runtime/runtime-failure.ts'
import { SessionClient } from '../packages/dsh-adapter/src/session-client.ts'
import { HostTransport } from '../packages/dsh-adapter/src/transport.ts'

// Basic-engine evidence only: the bootstrap Host on empty, disposable homes with
// no profile, settings, model key or Claw. Not App readiness and not a
// substitute for the governed packaged cold start (smoke:packaged).
for (let round = 1; round <= 3; round++) {
  const home = await mkdtemp(join(tmpdir(), 'corn-cold-start-'))
  const host = createBootstrapHost(home)
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
const host = createBootstrapHost(home)
try {
  const startup = host.start()
  await assert.rejects(host.start(), /already started/u)
  const stopped = host.stop()
  await assert.rejects(startup, HostStoppedError)
  await stopped
  assert.equal(host.processId, undefined)
  assert.equal(existsSync(join(home, 'corn-host.lock')), false)
  console.log('PASS stop during startup cancels it and releases its owned Host')
} finally {
  await host.stop()
  await rm(home, { recursive: true, force: true })
}
console.log(
  'Scope: basic-engine evidence (bootstrap Host, no Claw); governed Claw cold boot is smoke:packaged.',
)

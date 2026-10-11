import { DshHostSupervisor } from '../apps/desktop/src/runtime/dsh-host-supervisor.ts'
import { acquireProcessLock } from '../apps/desktop/src/runtime/process-lock.ts'
import { defaultDevelopmentHome } from '../apps/desktop/src/runtime/profile-bootstrap.ts'
import { installClaw } from './lib/claw-release.mjs'

const home = process.env.CORN_DSH_HOME ?? defaultDevelopmentHome()
const host = new DshHostSupervisor(home, { model: null })
try {
  await host.start()
} finally {
  await host.stop()
}
const releaseLock = await acquireProcessLock(home)
try {
  await installClaw(home)
  console.log(
    'Corn-owned Claw RC2 runtime is installed. Existing DSH installations were not used.',
  )
} finally {
  await releaseLock()
}

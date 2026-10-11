import { createGovernedHost } from '../apps/desktop/src/runtime/claw-runtime-check.ts'
import { createBootstrapHost } from '../apps/desktop/src/runtime/host-bootstrap.ts'
import { acquireProcessLock } from '../apps/desktop/src/runtime/process-lock.ts'
import { defaultDevelopmentHome } from '../apps/desktop/src/runtime/profile-bootstrap.ts'
import { installClaw } from './lib/claw-release.mjs'

const home = process.env.CORN_DSH_HOME ?? defaultDevelopmentHome()
// Basic engine only to create the profile; the result is not trusted until it
// passes the App's own governed admission below.
const bootstrap = createBootstrapHost(home)
try {
  await bootstrap.start()
} finally {
  await bootstrap.stop()
}
const releaseLock = await acquireProcessLock(home)
try {
  await installClaw(home)
} finally {
  await releaseLock()
}
const governed = createGovernedHost(home, { model: null })
try {
  await governed.start()
} finally {
  await governed.stop()
}
console.log(
  "Corn-owned Claw RC2 runtime is installed and passed Corn's formal Claw admission. Existing DSH installations were not used.",
)

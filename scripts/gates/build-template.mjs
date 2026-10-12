import { verifyTemplate } from '../../apps/desktop/src/runtime/profile-template.ts'
import { buildProfileTemplate } from '../lib/profile-template-build.mjs'
import { assertNetworkDenied, TEMPLATE } from './lib/gate-env.mjs'

// Run: node scripts/gates/run.mjs scripts/gates/build-template.mjs
// Builds the verified offline profile template every gate home is seeded from
// (locked DSH + SHA-checked Claw release, governed admission) with outbound
// network denied, so a pass also proves the build needs no network.
await assertNetworkDenied()
const started = Date.now()
await buildProfileTemplate(TEMPLATE)
await verifyTemplate(TEMPLATE)
console.log(
  JSON.stringify({
    template: TEMPLATE,
    ok: true,
    durationMs: Date.now() - started,
  }),
)

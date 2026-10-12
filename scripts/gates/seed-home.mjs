import { join } from 'node:path'
import { materializeProfile } from '../../apps/desktop/src/runtime/profile-template.ts'
import {
  assertHomeReleased,
  createRunHome,
  removeRunHome,
  TEMPLATE,
} from './lib/gate-env.mjs'

// Run: node scripts/gates/seed-home.mjs create <run>   -> prints a fresh seeded home
//      node scripts/gates/seed-home.mjs release <home> -> asserts no Host/lock, removes it
// For existing smokes that take CORN_DSH_HOME and expect an installed Claw profile.
const [action, value] = process.argv.slice(2)
if (action === 'create') {
  const home = await createRunHome(value)
  await materializeProfile(TEMPLATE, join(home, 'profiles', 'corn-dev'))
  console.log(home)
} else if (action === 'release') {
  const released = await assertHomeReleased(value)
  console.log(JSON.stringify(released))
  if (!released.ok) process.exit(1)
  await removeRunHome(value)
} else {
  console.error('usage: seed-home.mjs create <run> | release <home>')
  process.exit(2)
}

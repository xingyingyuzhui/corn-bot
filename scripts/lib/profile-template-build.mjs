import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative, sep } from 'node:path'
import {
  createGovernedHost,
  verifyClawProfile,
} from '../../apps/desktop/src/runtime/claw-runtime-check.ts'
import { createBootstrapHost } from '../../apps/desktop/src/runtime/host-bootstrap.ts'
import { CORN_PROFILE } from '../../apps/desktop/src/runtime/profile-bootstrap.ts'
import { writeTemplateManifest } from '../../apps/desktop/src/runtime/profile-template.ts'
import { installClaw } from './claw-release.mjs'

const PROFILE_FILES = new Set([
  'package.json',
  'cordis.yml',
  'cordis.patch.yml',
  'node_modules',
])

/** Package-manager state and `.bin` links are build-time only; the Host loads plain package trees. */
function keep(profile, source) {
  const path = relative(profile, source)
  if (path === '') return true
  const [top] = path.split(sep)
  if (!PROFILE_FILES.has(top)) return false
  return !basename(source).startsWith('.')
}

/**
 * Builds Corn's offline profile template: the basic engine creates the
 * profile, the pinned Claw release installs into it, the result must pass the
 * App's governed admission, and it is copied without links.
 */
export async function buildProfileTemplate(output) {
  const home = await mkdtemp(join(tmpdir(), 'corn-profile-template-'))
  try {
    const bootstrap = createBootstrapHost(home)
    try {
      await bootstrap.start()
    } finally {
      await bootstrap.stop()
    }
    await installClaw(home)
    const governed = createGovernedHost(home, { model: null })
    try {
      await governed.start()
    } finally {
      await governed.stop()
    }
    const profile = join(home, 'profiles', CORN_PROFILE)
    await rm(output, { recursive: true, force: true })
    await cp(profile, output, {
      recursive: true,
      filter: (source) => keep(profile, source),
    })
    await verifyClawProfile(output)
    await writeTemplateManifest(output)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

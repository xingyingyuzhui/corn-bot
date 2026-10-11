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
import { OwnedResources, untilAborted } from './owned-resources.mjs'

const PROFILE_FILES = new Set([
  'package.json',
  'cordis.yml',
  'cordis.patch.yml',
  'node_modules',
])

const HOSTS = Object.freeze({
  bootstrap: createBootstrapHost,
  governed: (home) => createGovernedHost(home, { model: null }),
})

/** Package-manager state and `.bin` links are build-time only; the Host loads plain package trees. */
function keep(profile, source) {
  const path = relative(profile, source)
  if (path === '') return true
  const [top] = path.split(sep)
  if (!PROFILE_FILES.has(top)) return false
  return !basename(source).startsWith('.')
}

/** Starts and stops one Host; it is owned before `start` so cancellation can stop it mid-start. */
async function startAndStop(owned, label, host) {
  const entry = owned.process(label, () => host.stop())
  await untilAborted(owned.signal, () => host.start())
  await owned.release(entry)
}

/**
 * Builds Corn's offline profile template: the basic engine creates the
 * profile, the pinned Claw release installs into it, the result must pass the
 * App's governed admission, and it is copied without links.
 *
 * The temp home, both Hosts and every install child are owned by this call and
 * released, within bounds, before it settles. Aborting `signal` stops them and
 * no later phase starts. A release failure rejects with `OwnedCleanupError`.
 */
export async function buildProfileTemplate(
  output,
  {
    signal,
    timing,
    hosts = HOSTS,
    install = installClaw,
    verify = verifyClawProfile,
  } = {},
) {
  signal?.throwIfAborted()
  const owned = new OwnedResources({ signal, timing })
  let failure
  try {
    const home = await mkdtemp(join(tmpdir(), 'corn-profile-template-'))
    owned.directory('template home', home)
    signal?.throwIfAborted()
    await startAndStop(owned, 'bootstrap Host', hosts.bootstrap(home))
    await untilAborted(signal, () => install(home, owned))
    signal?.throwIfAborted()
    await startAndStop(owned, 'governed Host', hosts.governed(home))
    const profile = join(home, 'profiles', CORN_PROFILE)
    signal?.throwIfAborted()
    // Not raced: an abandoned copy could keep writing after its target is removed.
    await rm(output, { recursive: true, force: true })
    await cp(profile, output, {
      recursive: true,
      filter: (source) => keep(profile, source),
    })
    await untilAborted(signal, () => verify(output))
    signal?.throwIfAborted()
    await writeTemplateManifest(output)
  } catch (error) {
    failure = error
  }
  try {
    await owned.close()
  } catch (error) {
    error.cause = signal?.aborted ? signal.reason : failure
    throw error
  }
  if (signal?.aborted) throw signal.reason
  if (failure) throw failure
}

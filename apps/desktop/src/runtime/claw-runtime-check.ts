import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import { CLAW_VERSION } from '../../../../packages/contracts/src/runtime.ts'
import { ClawRegistryClient } from '../../../../packages/dsh-adapter/src/claw-registry-client.ts'
import { HostTransport } from '../../../../packages/dsh-adapter/src/transport.ts'
import {
  type AdmissionContext,
  DSH_INSTALL_ANCHOR,
  DshHostSupervisor,
  type HostAdmission,
  type SupervisorOptions,
} from './dsh-host-supervisor.ts'
import { RuntimeFailure } from './runtime-failure.ts'

export const CLAW_SUITE = 'dsh-claw-suite'
/** Host rows the official suite bundle inserts through its own `cordis.patch.yml`. */
export const CLAW_ROWS = [
  CLAW_SUITE,
  'dsh-claw-policy',
  'dsh-claw-permissions',
  'dsh-claw-observability',
  'dsh-claw-identity',
  'dsh-claw-memory',
  'dsh-claw-gate',
  'dsh-claw-delegate',
  'dsh-claw-registry',
] as const
/** `dsh-claw-core` is a library dependency with no Host row. */
export const CLAW_COMPONENTS = [...CLAW_ROWS.slice(1), 'dsh-claw-core']
const CLAW_ROW_IDS: ReadonlySet<string> = new Set(CLAW_ROWS)
const PATCH_FILE = 'cordis.patch.yml'
const REGISTRY_CHECK_TIMEOUT_MS = 10_000

type Entry = Readonly<Record<string, unknown>>

function isEntry(value: unknown): value is Entry {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readManifest(directory: string): Promise<Entry | undefined> {
  try {
    const value: unknown = JSON.parse(
      await readFile(join(directory, 'package.json'), 'utf8'),
    )
    return isEntry(value) ? value : undefined
  } catch {
    return undefined
  }
}

function dshField(manifest: Entry, key: 'profile' | 'bundle'): Entry {
  const dsh = isEntry(manifest.dsh) ? manifest.dsh : {}
  return isEntry(dsh[key]) ? dsh[key] : {}
}

/** Mirrors DSH `resolveBundleDir`: Node's lookup paths from each anchor, in order. */
function resolvePackageDir(
  name: string,
  anchors: readonly string[],
): string | undefined {
  for (const anchor of anchors)
    for (const searchPath of createRequire(anchor).resolve.paths(name) ?? []) {
      const candidate = join(searchPath, name)
      if (existsSync(join(candidate, 'package.json'))) return candidate
    }
  return undefined
}

/** A patch layer Corn cannot fully read (custom tags, syntax errors) is treated as possibly disabling Claw. */
async function readPatchLayer(path: string): Promise<readonly unknown[]> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new RuntimeFailure(
      'claw_disabled',
      'A profile patch layer cannot be read',
      {
        cause: error,
      },
    )
  }
  const document = parseDocument(text)
  const value: unknown =
    document.errors.length === 0 && document.warnings.length === 0
      ? document.toJS()
      : undefined
  if (value === null) return []
  if (!Array.isArray(value))
    throw new RuntimeFailure(
      'claw_disabled',
      'A profile patch layer cannot be verified',
    )
  return value
}

function disables(entry: Entry): boolean {
  return Boolean(entry.disabled) || ('name' in entry && entry.name !== entry.id)
}

/**
 * Static admission against the profile the Host is about to load. Never
 * repairs, rewrites or removes anything; a failure leaves the profile as found.
 */
export async function verifyClawProfile(
  profile: string,
  home?: string,
): Promise<void> {
  const manifest = await readManifest(profile)
  if (!manifest)
    throw new RuntimeFailure('claw_missing', 'Corn profile is missing')
  const suiteDir = resolvePackageDir(CLAW_SUITE, [
    DSH_INSTALL_ANCHOR,
    join(profile, 'package.json'),
  ])
  const suite = suiteDir ? await readManifest(suiteDir) : undefined
  if (!suiteDir || suite?.name !== CLAW_SUITE)
    throw new RuntimeFailure('claw_missing', 'Claw suite is not installed')
  if (suite.version !== CLAW_VERSION)
    throw new RuntimeFailure(
      'claw_version_mismatch',
      'Installed Claw suite differs from the locked version',
    )
  const bundles = dshField(manifest, 'profile').bundles
  if (!Array.isArray(bundles) || !bundles.includes(CLAW_SUITE))
    throw new RuntimeFailure(
      'claw_disabled',
      'Claw suite is not enabled in dsh.profile.bundles',
    )
  for (const name of CLAW_COMPONENTS) {
    const directory = resolvePackageDir(name, [join(suiteDir, 'package.json')])
    const component = directory ? await readManifest(directory) : undefined
    if (component?.name !== name)
      throw new RuntimeFailure('claw_missing', `${name} is not installed`)
    if (component.version !== CLAW_VERSION)
      throw new RuntimeFailure(
        'claw_version_mismatch',
        `${name} differs from the locked version`,
      )
  }
  const declared = dshField(suite, 'bundle').patch
  const files = typeof declared === 'string' ? [declared] : declared
  if (
    !Array.isArray(files) ||
    !files.every((file): file is string => typeof file === 'string')
  )
    throw new RuntimeFailure('claw_missing', 'Claw suite declares no bundle')
  const inserted = new Map<string, Entry>()
  for (const file of files)
    for (const patch of await readPatchLayer(join(suiteDir, file)))
      if (isEntry(patch) && Array.isArray(patch.insert))
        for (const row of patch.insert)
          if (isEntry(row) && typeof row.id === 'string')
            inserted.set(row.id, row)
  for (const id of CLAW_ROWS) {
    const row = inserted.get(id)
    if (!row || row.name !== id || disables(row))
      throw new RuntimeFailure(
        'claw_disabled',
        `Claw suite bundle does not load ${id}`,
      )
  }
  const layers = [join(profile, PATCH_FILE)]
  if (home !== undefined) layers.push(join(home, PATCH_FILE))
  for (const layer of layers)
    for (const patch of await readPatchLayer(layer)) {
      if (!isEntry(patch)) continue
      const rows = [patch, ...(Array.isArray(patch.insert) ? patch.insert : [])]
      for (const row of rows)
        if (
          isEntry(row) &&
          typeof row.id === 'string' &&
          CLAW_ROW_IDS.has(row.id) &&
          disables(row)
        )
          throw new RuntimeFailure(
            'claw_disabled',
            `A profile patch layer disables or replaces ${row.id}`,
          )
    }
}

/**
 * Post-authentication admission: the Host must not have skipped the suite and
 * its Registry must answer `list` with a valid revision. Registry liveness
 * alone does not prove the Gate works; that is the static check's and the
 * governance smoke's job.
 */
export async function checkClawRuntime({
  auth,
  signal,
  skippedBundles,
}: AdmissionContext): Promise<void> {
  let failure: unknown
  try {
    await new ClawRegistryClient(new HostTransport(auth)).revision({
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(REGISTRY_CHECK_TIMEOUT_MS),
      ]),
    })
  } catch (error) {
    // An exit or a refused connection is the Host's failure, not Claw's.
    if (signal.aborted || error instanceof TypeError) throw error
    failure = error
  }
  if (skippedBundles.has(CLAW_SUITE))
    throw new RuntimeFailure(
      'claw_missing',
      'DSH skipped the Claw suite bundle',
    )
  if (failure !== undefined)
    throw new RuntimeFailure(
      'claw_check_failed',
      'Claw Registry capability check failed',
      { cause: failure },
    )
}

export const CLAW_ADMISSION: HostAdmission = {
  beforeSpawn: (home, profile) => verifyClawProfile(profile, home),
  afterAuth: checkClawRuntime,
}

/** The only Host entry for App readiness: every start re-runs both admissions. */
export function createGovernedHost(
  home: string,
  options: Omit<SupervisorOptions, 'admission'> = {},
): DshHostSupervisor {
  return new DshHostSupervisor(home, { ...options, admission: CLAW_ADMISSION })
}

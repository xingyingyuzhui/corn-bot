import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { CLAW_VERSION } from '../../../../packages/contracts/src/runtime.ts'
import { ClawGateClient } from '../../../../packages/dsh-adapter/src/claw-gate-client.ts'
import { ClawRegistryClient } from '../../../../packages/dsh-adapter/src/claw-registry-client.ts'
import { HostTransport } from '../../../../packages/dsh-adapter/src/transport.ts'
import {
  composeEntries,
  type Entry,
  isEntry,
  parsePatchLayer,
  verifyClawTopology,
} from './claw-topology.ts'
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
/** Union of the `inject` exports of the locked 0.3.0-rc.2 Claw row plugins. */
const CLAW_SERVICES: ReadonlySet<string> = new Set([
  'tools',
  'connection',
  'skills',
  'agents',
  'subagents',
  'systemPrompt',
  'workspaceRegistry',
  'agentPresets',
  'settings',
  'sessionController',
])
const PATCH_FILE = 'cordis.patch.yml'
const CLAW_CHECK_TIMEOUT_MS = 10_000

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

/** Mirrors DSH `bundlePatchFiles`: one file or an ordered list of files. */
function bundlePatchFiles(bundle: Entry): readonly string[] | undefined {
  const declared =
    typeof bundle.patch === 'string' ? [bundle.patch] : bundle.patch
  return Array.isArray(declared) &&
    declared.every((file): file is string => typeof file === 'string')
    ? declared
    : undefined
}

/**
 * A patch layer Corn cannot fully read (unknown tags, syntax errors) is
 * treated as possibly disabling Claw. A missing optional layer (profile or
 * home) is no layer; a missing named layer (bundle file, overlay) is refused.
 */
async function readPatchLayer(
  path: string,
  { optional }: { readonly optional: boolean },
): Promise<readonly unknown[]> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT')
      return []
    throw new RuntimeFailure(
      'claw_disabled',
      'A profile patch layer cannot be read',
      {
        cause: error,
      },
    )
  }
  return parsePatchLayer(text)
}

function disables(entry: Entry): boolean {
  return Boolean(entry.disabled) || ('name' in entry && entry.name !== entry.id)
}

/**
 * Every bundle layer DSH would load, in `dsh.profile.bundles` order. A bundle
 * DSH skips (unresolvable, no manifest or `dsh.bundle`) contributes no layer
 * there either; a declared patch file Corn cannot read is refused.
 */
async function bundleLayers(
  bundles: readonly unknown[],
  profile: string,
): Promise<unknown[]> {
  const patches: unknown[] = []
  for (const name of bundles) {
    if (typeof name !== 'string') continue
    const directory = resolvePackageDir(name, [
      DSH_INSTALL_ANCHOR,
      join(profile, 'package.json'),
    ])
    const manifest = directory ? await readManifest(directory) : undefined
    const bundle = isEntry(manifest?.dsh) ? manifest.dsh.bundle : undefined
    const files = isEntry(bundle) ? bundlePatchFiles(bundle) : undefined
    if (!directory || !files) continue
    for (const file of files)
      patches.push(
        ...(await readPatchLayer(join(directory, file), { optional: false })),
      )
  }
  return patches
}

/**
 * Static admission against the profile the Host is about to load, composed
 * from every effective layer in DSH's order: bundles, the profile's and the
 * home's `cordis.patch.yml`, then the launcher's `--patch` overlays. Never
 * repairs, rewrites or removes anything; a failure leaves the profile as found.
 */
export async function verifyClawProfile(
  profile: string,
  home?: string,
  overlays: readonly string[] = [],
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
  const files = bundlePatchFiles(dshField(suite, 'bundle'))
  if (!files)
    throw new RuntimeFailure('claw_missing', 'Claw suite declares no bundle')
  const inserted = new Map<string, Entry>()
  for (const file of files)
    for (const patch of await readPatchLayer(join(suiteDir, file), {
      optional: false,
    }))
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
  const userLayers: Array<readonly unknown[]> = [
    await readPatchLayer(join(profile, PATCH_FILE), { optional: true }),
  ]
  if (home !== undefined)
    userLayers.push(
      await readPatchLayer(join(home, PATCH_FILE), { optional: true }),
    )
  for (const overlay of overlays)
    userLayers.push(await readPatchLayer(overlay, { optional: false }))
  for (const layer of userLayers)
    for (const patch of layer) {
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
  verifyClawTopology(
    composeEntries([
      ...(await bundleLayers(bundles, profile)),
      ...userLayers.flat(),
    ]),
    CLAW_ROW_IDS,
    CLAW_SERVICES,
  )
}

/** Runs one capability probe; the child's own exit or a refused connection stays the Host's failure. */
async function probe(
  run: (signal: AbortSignal) => Promise<unknown>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<{ readonly failure: unknown } | undefined> {
  try {
    await run(AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]))
    return undefined
  } catch (error) {
    if (signal.aborted || error instanceof TypeError) throw error
    return { failure: error }
  }
}

/**
 * Post-authentication admission: the Host must not have skipped the suite,
 * its Registry must answer `list` with a valid revision, and the Gate must
 * have mounted its audit route. A mounted route proves the Gate's `apply`
 * ran (it installs the tool guard first); the governance smoke proves the
 * guard itself.
 */
export async function checkClawRuntime(
  { auth, signal, skippedBundles }: AdmissionContext,
  timeoutMs = CLAW_CHECK_TIMEOUT_MS,
): Promise<void> {
  const transport = new HostTransport(auth)
  const registry = await probe(
    (bounded) =>
      new ClawRegistryClient(transport).revision({ signal: bounded }),
    signal,
    timeoutMs,
  )
  if (skippedBundles.has(CLAW_SUITE))
    throw new RuntimeFailure(
      'claw_missing',
      'DSH skipped the Claw suite bundle',
    )
  if (registry)
    throw new RuntimeFailure(
      'claw_check_failed',
      'Claw Registry capability check failed',
      { cause: registry.failure },
    )
  const gate = await probe(
    (bounded) =>
      new ClawGateClient(transport).verifyMounted({ signal: bounded }),
    signal,
    timeoutMs,
  )
  if (gate)
    throw new RuntimeFailure(
      'claw_check_failed',
      'Claw Gate capability check failed',
      { cause: gate.failure },
    )
}

export interface ClawAdmissionOptions {
  /** Deadline of each post-authentication capability probe. */
  readonly clawCheckTimeoutMs?: number
}

export function createClawAdmission({
  clawCheckTimeoutMs = CLAW_CHECK_TIMEOUT_MS,
}: ClawAdmissionOptions = {}): HostAdmission {
  return {
    beforeSpawn: (home, profile, overlays) =>
      verifyClawProfile(profile, home, overlays),
    afterAuth: (context) => checkClawRuntime(context, clawCheckTimeoutMs),
  }
}

export const CLAW_ADMISSION: HostAdmission = createClawAdmission()

/** The only Host entry for App readiness: every start re-runs both admissions. */
export function createGovernedHost(
  home: string,
  {
    clawCheckTimeoutMs,
    ...options
  }: Omit<SupervisorOptions, 'admission'> & ClawAdmissionOptions = {},
): DshHostSupervisor {
  return new DshHostSupervisor(home, {
    ...options,
    admission:
      clawCheckTimeoutMs === undefined
        ? CLAW_ADMISSION
        : createClawAdmission({ clawCheckTimeoutMs }),
  })
}

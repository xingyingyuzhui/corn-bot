import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { type CornModelConfig, routePlan } from './model-provider.ts'

export const CORN_PROFILE = 'corn-dev'
const MARKER = '.corn-bot-home.json'
const HOME_ID =
  /^home_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

/** Real path of `path`, or of its nearest existing ancestor joined with the rest. */
export function canonicalPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    const parent = dirname(path)
    if (parent === path) throw new Error('Cannot resolve runtime home')
    return resolve(canonicalPath(parent), relative(parent, path))
  }
}

/** Reject the user's DSH home, including symlink aliases and ancestor paths. */
export function assertIsolatedHome(candidate: string): string {
  if (!isAbsolute(candidate))
    throw new Error('Corn runtime home must be absolute')
  const home = canonicalPath(resolve(candidate))
  const userDsh = canonicalPath(join(homedir(), '.dsh'))
  const inside = relative(userDsh, home)
  const ancestor = relative(home, userDsh)
  const escapes = (path: string) =>
    path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)
  if (
    inside === '' ||
    !escapes(inside) ||
    ancestor === '' ||
    !escapes(ancestor)
  ) {
    throw new Error('Refusing an existing user DSH home or its ancestor')
  }
  return home
}

export function defaultDevelopmentHome(): string {
  return join(homedir(), '.corn-bot-dev', 'dsh')
}

type HomeMarker = Readonly<Record<string, unknown>> & {
  readonly owner: 'corn-bot'
}

async function readHomeMarker(home: string): Promise<HomeMarker | null> {
  let owner: unknown
  try {
    owner = JSON.parse(await readFile(join(home, MARKER), 'utf8'))
  } catch {
    return null
  }
  return typeof owner === 'object' &&
    owner !== null &&
    !Array.isArray(owner) &&
    'owner' in owner &&
    owner.owner === 'corn-bot'
    ? (owner as HomeMarker)
    : null
}

const mintHomeId = (): string => `home_${randomUUID()}`

/**
 * Claims an empty or Corn-owned home. The marker carries a `homeId` that the
 * Corn database pairs with; a legacy marker without one gains it here, with
 * its other fields kept.
 */
export async function claimCornHome(candidate: string): Promise<string> {
  const home = assertIsolatedHome(candidate)
  await mkdir(home, { recursive: true, mode: 0o700 })
  const marker = join(home, MARKER)
  const entries = await readdir(home)
  if (entries.length > 0) {
    const owner = await readHomeMarker(home)
    if (owner === null) {
      throw new Error('Refusing to adopt a nonempty home not owned by Corn Bot')
    }
    if (owner.homeId === undefined) {
      const staged = `${marker}.${randomUUID()}.tmp`
      await writeFile(
        staged,
        `${JSON.stringify({ ...owner, homeId: mintHomeId() })}\n`,
        { flag: 'wx', mode: 0o600 },
      )
      await rename(staged, marker)
    }
  } else {
    await writeFile(
      marker,
      `${JSON.stringify({ owner: 'corn-bot', schemaVersion: 1, homeId: mintHomeId() })}\n`,
      {
        flag: 'wx',
        mode: 0o600,
      },
    )
  }
  return home
}

/**
 * Read-only: the `homeId` of a Corn-owned home, or `undefined` while the home
 * is unclaimed, foreign, or carries a malformed id. Never creates or edits it.
 */
export async function readCornHomeId(
  candidate: string,
): Promise<string | undefined> {
  const owner = await readHomeMarker(assertIsolatedHome(candidate))
  const homeId = owner?.homeId
  return typeof homeId === 'string' && HOME_ID.test(homeId) ? homeId : undefined
}

/** Only the selected Corn route's credential enters this standalone runtime. */
export function cornHostEnvironment(
  home: string,
  model: CornModelConfig | null,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    DSH_HOME: assertIsolatedHome(home),
    DSH_TELEMETRY_DISABLED: '1',
  }
  for (const key of [
    'PATH',
    'HOME',
    'TMPDIR',
    'TEMP',
    'TMP',
    'LANG',
    'LC_ALL',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
  ]) {
    if (process.env[key] !== undefined) environment[key] = process.env[key]
  }
  if (model) environment[routePlan(model.route).hostKeyEnv] = model.apiKey
  if (process.versions.electron) environment.ELECTRON_RUN_AS_NODE = '1'
  return environment
}

/**
 * The default workspace must also stay inside Corn-owned data. Route entries
 * carry credential references only; JSON is emitted because it is valid YAML.
 */
export async function writeIsolationPatch(
  home: string,
  model: CornModelConfig | null,
): Promise<string> {
  const path = join(home, 'corn-isolation.patch.yml')
  const entries = [
    {
      id: 'workspace-controller',
      config: { documentsDirectory: join(home, 'documents') },
    },
    ...(model ? routePlan(model.route).patch : []),
  ]
  await writeFile(path, `${JSON.stringify(entries, null, 2)}\n`, {
    mode: 0o600,
  })
  return path
}

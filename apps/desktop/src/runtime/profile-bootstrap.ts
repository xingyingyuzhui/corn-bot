import { realpathSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const CORN_PROFILE = 'corn-dev'
const MARKER = '.corn-bot-home.json'

function canonicalPath(path: string): string {
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

export async function claimCornHome(candidate: string): Promise<string> {
  const home = assertIsolatedHome(candidate)
  await mkdir(home, { recursive: true, mode: 0o700 })
  const marker = join(home, MARKER)
  const entries = await readdir(home)
  if (entries.length > 0) {
    const owner: unknown = JSON.parse(
      await readFile(marker, 'utf8').catch(() => 'null'),
    )
    if (
      typeof owner !== 'object' ||
      owner === null ||
      !('owner' in owner) ||
      owner.owner !== 'corn-bot'
    ) {
      throw new Error('Refusing to adopt a nonempty home not owned by Corn Bot')
    }
  } else {
    await writeFile(
      marker,
      `${JSON.stringify({ owner: 'corn-bot', schemaVersion: 1 })}\n`,
      {
        flag: 'wx',
        mode: 0o600,
      },
    )
  }
  return home
}

/** Only explicit Corn model credentials enter this standalone runtime. */
export function cornHostEnvironment(home: string): NodeJS.ProcessEnv {
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
  if (process.env.CORN_DEEPSEEK_API_KEY) {
    environment.DEEPSEEK_API_KEY = process.env.CORN_DEEPSEEK_API_KEY
  }
  if (process.versions.electron) environment.ELECTRON_RUN_AS_NODE = '1'
  return environment
}

/** The default workspace must also stay inside Corn-owned data. */
export async function writeIsolationPatch(home: string): Promise<string> {
  const path = join(home, 'corn-isolation.patch.yml')
  const documentDirectory = JSON.stringify(join(home, 'documents'))
  await writeFile(
    path,
    `- id: workspace-controller\n  config:\n    documentsDirectory: ${documentDirectory}\n`,
    { mode: 0o600 },
  )
  return path
}

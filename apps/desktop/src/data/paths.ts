import { chmod, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import {
  assertIsolatedHome,
  canonicalPath,
} from '../runtime/profile-bootstrap.ts'

const MARKER = '.corn-bot-data.json'
export const DATA_LOCK_FILE = 'corn-data.lock'

/** Files inside Corn's data directory. Nothing here lives in the DSH home. */
export interface DataPaths {
  readonly dir: string
  readonly database: string
  readonly backups: string
  readonly marker: string
}

export function dataPaths(dir: string): DataPaths {
  return {
    dir,
    database: join(dir, 'corn.sqlite'),
    backups: join(dir, 'backups'),
    marker: join(dir, MARKER),
  }
}

/** `<home>-data` beside the DSH home, so every worktree's home gets its own database. */
export function siblingDataDir(home: string): string {
  return join(dirname(home), `${basename(home)}-data`)
}

const outside = (path: string) =>
  path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)

/**
 * Canonical data directory. Refuses relative paths, the user's `~/.dsh`
 * (inside, itself or an ancestor, symlinks resolved) and any overlap with
 * the Corn DSH home: the data directory is neither the home, inside it, nor
 * one of its ancestors.
 */
export function assertIsolatedDataDir(candidate: string, home: string): string {
  if (!isAbsolute(candidate) || !isAbsolute(home))
    throw new Error('Corn data directory and runtime home must be absolute')
  const dir = assertIsolatedHome(candidate)
  const dshHome = canonicalPath(home)
  if (!outside(relative(dshHome, dir)) || !outside(relative(dir, dshHome)))
    throw new Error('Refusing a data directory that overlaps the runtime home')
  return dir
}

async function ownedByCorn(marker: string): Promise<boolean> {
  try {
    const owner: unknown = JSON.parse(await readFile(marker, 'utf8'))
    return (
      typeof owner === 'object' &&
      owner !== null &&
      'owner' in owner &&
      owner.owner === 'corn-bot'
    )
  } catch {
    return false
  }
}

/**
 * Creates the directory `0700` with an owner marker, or adopts one that
 * already carries it. A nonempty directory without the marker is refused.
 */
export async function claimDataDir(paths: DataPaths): Promise<void> {
  await mkdir(paths.dir, { recursive: true, mode: 0o700 })
  if ((await readdir(paths.dir)).length === 0) {
    await writeFile(
      paths.marker,
      `${JSON.stringify({ owner: 'corn-bot', kind: 'data', schemaVersion: 1 })}\n`,
      { flag: 'wx', mode: 0o600 },
    )
    return
  }
  if (!(await ownedByCorn(paths.marker)))
    throw new Error('Refusing a nonempty data directory not owned by Corn Bot')
  await chmod(paths.dir, 0o700)
}

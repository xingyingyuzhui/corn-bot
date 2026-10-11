import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * The environment for a git child bound to its `cwd`: inherited `GIT_DIR`,
 * `GIT_WORK_TREE`, `GIT_INDEX_FILE` and the like would redirect it to another
 * repository.
 */
export function cwdGitEnv(env = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !key.startsWith('GIT_')),
  )
}

export async function readKitLock(repoRoot) {
  const lock = JSON.parse(
    await readFile(join(repoRoot, 'design/grok-kit/kit.lock.json'), 'utf8'),
  )
  if (lock.schemaVersion !== 1) throw new Error('Unsupported kit lock schema')
  if (!/^[0-9a-f]{40}$/.test(lock.commit))
    throw new Error('Kit lock commit must be a full SHA')
  return lock
}

export function resolveKitDir(repoRoot, lock, override) {
  const dir = override || lock.researchDir
  return isAbsolute(dir) ? dir : resolve(repoRoot, dir)
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function sha256File(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
}

async function git(cwd, args) {
  const { stdout } = await run('git', args, {
    cwd,
    env: cwdGitEnv(),
    maxBuffer: 64 * 1024 * 1024,
  })
  return stdout
}

/** Blob ids at the pinned commit, so research working-tree edits cannot hide a copy. */
async function pinnedBlobIndex(kitDir, commit, minBytes) {
  const index = new Map()
  for (const entry of (
    await git(kitDir, ['ls-tree', '-r', '-l', '-z', commit])
  ).split('\0')) {
    const match = /^\d+ blob ([0-9a-f]+) +(\d+)\t(.+)$/su.exec(entry)
    if (match && Number(match[2]) >= minBytes) index.set(match[1], match[3])
  }
  return index
}

async function cornBlobIndex(repoRoot, minBytes) {
  const files = []
  for (const file of (
    await git(repoRoot, [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
    ])
  )
    .split('\0')
    .filter(Boolean)) {
    const info = await stat(join(repoRoot, file)).catch(() => null)
    if (info?.isFile() && info.size >= minBytes) files.push(file)
  }
  const index = new Map()
  for (let start = 0; start < files.length; start += 500) {
    const batch = files.slice(start, start + 500)
    const ids = (
      await git(repoRoot, ['hash-object', '--no-filters', '--', ...batch])
    )
      .trim()
      .split('\n')
    for (const [offset, id] of ids.entries()) index.set(id, batch[offset])
  }
  return index
}

export async function findCopiedKitFiles({
  repoRoot,
  kitDir,
  commit,
  minBytes,
}) {
  const kit = await pinnedBlobIndex(kitDir, commit, minBytes)
  const copies = []
  for (const [id, cornFile] of await cornBlobIndex(repoRoot, minBytes)) {
    const kitFile = kit.get(id)
    if (kitFile) copies.push({ cornFile, kitFile })
  }
  return copies
}

export async function verifyUiKitReference({ repoRoot, kitDirOverride }) {
  const lock = await readKitLock(repoRoot)
  const kitDir = resolveKitDir(repoRoot, lock, kitDirOverride)
  const report = { commit: lock.commit, kitDir, failures: [] }

  if (!(await isDirectory(kitDir))) {
    return {
      ...report,
      status: 'skipped',
      reason: `Research checkout not found; clone ${lock.repository} at ${lock.commit} into ${lock.researchDir} or set CORN_UI_KIT_DIR`,
    }
  }

  let head
  try {
    head = (
      await run('git', ['rev-parse', 'HEAD'], {
        cwd: kitDir,
        env: cwdGitEnv(),
      })
    ).stdout.trim()
  } catch {
    report.failures.push('Research directory is not a git checkout')
  }
  if (head && head !== lock.commit)
    report.failures.push(`Kit HEAD ${head} does not match pin ${lock.commit}`)

  for (const [file, expected] of Object.entries(lock.requiredFiles)) {
    const path = join(kitDir, file)
    let actual
    try {
      actual = await sha256File(path)
    } catch {
      report.failures.push(`Missing research file ${file}`)
      continue
    }
    if (actual !== expected)
      report.failures.push(`Research file ${file} does not match its pin`)
  }

  if (head) {
    const copies = await findCopiedKitFiles({
      repoRoot,
      kitDir,
      commit: lock.commit,
      minBytes: lock.copyDetectionMinBytes,
    }).catch(() => {
      report.failures.push(`Pinned commit ${lock.commit} is not available`)
      return []
    })
    for (const { cornFile, kitFile } of copies)
      report.failures.push(
        `Corn file ${cornFile} is a byte copy of research file ${kitFile}`,
      )
  }

  return {
    ...report,
    status: report.failures.length === 0 ? 'verified' : 'failed',
  }
}

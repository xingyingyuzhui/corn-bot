import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

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

async function gitFiles(cwd, args) {
  const { stdout } = await run('git', ['ls-files', '-z', ...args], {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  })
  return stdout.split('\0').filter(Boolean)
}

async function hashIndex(root, files, minBytes) {
  const index = new Map()
  for (const file of files) {
    const path = join(root, file)
    let info
    try {
      info = await stat(path)
    } catch {
      continue
    }
    if (!info.isFile() || info.size < minBytes) continue
    index.set(await sha256File(path), file)
  }
  return index
}

export async function findCopiedKitFiles({ repoRoot, kitDir, minBytes }) {
  const kit = await hashIndex(kitDir, await gitFiles(kitDir, []), minBytes)
  const corn = await hashIndex(
    repoRoot,
    await gitFiles(repoRoot, ['--cached', '--others', '--exclude-standard']),
    minBytes,
  )
  const copies = []
  for (const [hash, cornFile] of corn) {
    const kitFile = kit.get(hash)
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
      await run('git', ['rev-parse', 'HEAD'], { cwd: kitDir })
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
      minBytes: lock.copyDetectionMinBytes,
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

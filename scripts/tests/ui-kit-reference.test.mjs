import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { cwdGitEnv, verifyUiKitReference } from '../lib/ui-kit-reference.mjs'

const run = promisify(execFile)
const researchBody = 'research-only specification\n'.repeat(20)
const assetBody = 'unpinned research asset bytes\n'.repeat(20)

async function git(cwd, ...args) {
  return (await run('git', args, { cwd, env: cwdGitEnv() })).stdout.trim()
}

async function initRepo(dir) {
  await mkdir(dir, { recursive: true })
  await git(dir, 'init', '--quiet')
  await git(dir, 'config', 'user.email', 'test@example.invalid')
  await git(dir, 'config', 'user.name', 'test')
}

async function fixture({ commitOverride, docBody = researchBody } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'corn-kit-test-'))
  const corn = join(root, 'corn')
  const kit = join(root, 'kit')
  await initRepo(kit)
  await mkdir(join(kit, 'docs'))
  await writeFile(join(kit, 'docs/spec.md'), researchBody)
  await mkdir(join(kit, 'assets'))
  await writeFile(join(kit, 'assets/glyphs.bin'), assetBody)
  await git(kit, 'add', '.')
  await git(kit, 'commit', '--quiet', '-m', 'kit')
  const head = await git(kit, 'rev-parse', 'HEAD')
  if (docBody !== researchBody)
    await writeFile(join(kit, 'docs/spec.md'), docBody)

  await initRepo(corn)
  await mkdir(join(corn, 'design/grok-kit'), { recursive: true })
  await writeFile(
    join(corn, 'design/grok-kit/kit.lock.json'),
    JSON.stringify({
      schemaVersion: 1,
      repository: 'https://example.invalid/kit',
      commit: commitOverride ?? head,
      researchDir: kit,
      copyDetectionMinBytes: 64,
      requiredFiles: {
        'docs/spec.md': createHash('sha256').update(researchBody).digest('hex'),
      },
    }),
  )
  return { root, corn, kit }
}

test('verifies a pinned research checkout with matching files', async () => {
  const { root, corn } = await fixture()
  try {
    const report = await verifyUiKitReference({ repoRoot: corn })
    assert.equal(report.status, 'verified')
    assert.deepEqual(report.failures, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an inherited GIT_DIR never redirects git to another repository', async () => {
  const decoy = await mkdtemp(join(tmpdir(), 'corn-kit-decoy-'))
  const inherited = {
    GIT_DIR: process.env.GIT_DIR,
    GIT_WORK_TREE: process.env.GIT_WORK_TREE,
  }
  let root
  try {
    await git(decoy, 'init', '--quiet')
    process.env.GIT_DIR = join(decoy, '.git')
    process.env.GIT_WORK_TREE = decoy
    const built = await fixture()
    root = built.root
    const report = await verifyUiKitReference({ repoRoot: built.corn })
    assert.equal(report.status, 'verified')
  } finally {
    for (const [key, value] of Object.entries(inherited))
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
  }
  try {
    assert.equal(await git(decoy, 'rev-list', '--all', '--count'), '0')
    await assert.rejects(git(decoy, 'config', '--local', 'user.email'))
  } finally {
    await rm(decoy, { recursive: true, force: true })
    if (root) await rm(root, { recursive: true, force: true })
  }
})

test('reports a missing checkout as skipped with a diagnostic', async () => {
  const { root, corn } = await fixture()
  try {
    const report = await verifyUiKitReference({
      repoRoot: corn,
      kitDirOverride: join(root, 'absent'),
    })
    assert.equal(report.status, 'skipped')
    assert.match(report.reason, /CORN_UI_KIT_DIR/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects a checkout at a different commit', async () => {
  const { root, corn } = await fixture({ commitOverride: 'a'.repeat(40) })
  try {
    const report = await verifyUiKitReference({ repoRoot: corn })
    assert.equal(report.status, 'failed')
    assert.match(report.failures.join('\n'), /does not match pin/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects a research file whose content drifted from its pin', async () => {
  const { root, corn } = await fixture({ docBody: 'edited locally\n' })
  try {
    const report = await verifyUiKitReference({ repoRoot: corn })
    assert.equal(report.status, 'failed')
    assert.match(report.failures.join('\n'), /docs\/spec\.md does not match/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects Corn files that are byte copies of research files', async () => {
  const { root, corn } = await fixture()
  try {
    await mkdir(join(corn, 'apps'), { recursive: true })
    await writeFile(join(corn, 'apps/copied.md'), researchBody)
    const report = await verifyUiKitReference({ repoRoot: corn })
    assert.equal(report.status, 'failed')
    assert.match(
      report.failures.join('\n'),
      /apps\/copied\.md is a byte copy of research file docs\/spec\.md/u,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

for (const [label, tamper] of [
  ['edited', (path) => writeFile(path, 'locally edited\n')],
  ['deleted', (path) => rm(path)],
]) {
  test(`detects copies of unpinned research assets ${label} after pinning`, async () => {
    const { root, corn, kit } = await fixture()
    try {
      await mkdir(join(corn, 'apps'), { recursive: true })
      await writeFile(join(corn, 'apps/glyphs.bin'), assetBody)
      await tamper(join(kit, 'assets/glyphs.bin'))
      const report = await verifyUiKitReference({ repoRoot: corn })
      assert.equal(report.status, 'failed')
      assert.match(
        report.failures.join('\n'),
        /apps\/glyphs\.bin is a byte copy of research file assets\/glyphs\.bin/u,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}

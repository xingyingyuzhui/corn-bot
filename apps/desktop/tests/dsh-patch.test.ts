import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  DSH_INSTALL_ANCHOR,
  DshHostSupervisor,
} from '../src/runtime/dsh-host-supervisor.ts'
import {
  DSH_PATCHES,
  type DshPatch,
  verifyDshPatches,
} from '../src/runtime/dsh-patch.ts'
import { RuntimeFailure } from '../src/runtime/runtime-failure.ts'

const root = new URL('../../../', import.meta.url)
const sha256 = (data: string | Buffer) =>
  createHash('sha256').update(data).digest('hex')
const readRoot = (path: string) => readFile(new URL(path, root))

const isPatchMismatch = (error: unknown) =>
  error instanceof RuntimeFailure && error.code === 'runtime_patch_mismatch'

const PACKAGE = '@deepseek-ai/dsh-api-session-controller'
const FILE = 'lib/index.js'

/** A minimal install tree: the DSH CLI and one copy of the patched package. */
async function fixtureTree(
  manifest: Record<string, unknown> | null,
  content = 'patched',
): Promise<{ readonly anchor: string; readonly cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'corn-dsh-patch-'))
  const modules = join(dir, 'node_modules', '@deepseek-ai')
  await mkdir(join(modules, 'dsh'), { recursive: true })
  await writeFile(join(modules, 'dsh', 'package.json'), '{}\n')
  if (manifest) {
    const target = join(modules, 'dsh-api-session-controller')
    await mkdir(join(target, 'lib'), { recursive: true })
    await writeFile(join(target, 'package.json'), JSON.stringify(manifest))
    await writeFile(join(target, FILE), content)
  }
  return {
    anchor: join(modules, 'dsh', 'package.json'),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

const fixturePatch: DshPatch = {
  id: 'U1',
  package: PACKAGE,
  version: '0.2.0-rc.2',
  patch: 'patches/fixture.patch',
  sha256: '0'.repeat(64),
  files: { [FILE]: sha256('patched') },
}

test('the lock, the TS mirror, the patch file and pnpm agree', async () => {
  const lock = JSON.parse((await readRoot('runtime.lock.json')).toString())
  assert.deepEqual(lock.dshPatches, DSH_PATCHES)
  const workspace = (await readRoot('pnpm-workspace.yaml')).toString()
  const pnpmLock = (await readRoot('pnpm-lock.yaml')).toString()
  for (const patch of DSH_PATCHES) {
    assert.equal(sha256(await readRoot(patch.patch)), patch.sha256)
    const key = `'${patch.package}@${patch.version}'`
    assert.ok(workspace.includes(`${key}: ${patch.patch}\n`))
    assert.ok(pnpmLock.includes(`${key}: ${patch.sha256}\n`))
    for (const file of Object.keys(patch.files))
      assert.ok(
        (await readRoot(patch.patch))
          .toString()
          .includes(`diff --git a/${file} b/${file}\n`),
        `${patch.id} patch must change ${file}`,
      )
  }
})

test('the installed DSH runtime carries every locked patch', async () => {
  await verifyDshPatches(DSH_INSTALL_ANCHOR)
})

test('a patched copy passes; altered, missing or foreign copies are refused', async () => {
  const cases: ReadonlyArray<
    readonly [string, Record<string, unknown> | null, string, boolean]
  > = [
    ['patched', { name: PACKAGE, version: '0.2.0-rc.2' }, 'patched', true],
    ['altered', { name: PACKAGE, version: '0.2.0-rc.2' }, 'original', false],
    ['missing', null, 'patched', false],
    [
      'other version',
      { name: PACKAGE, version: '0.2.0-rc.3' },
      'patched',
      false,
    ],
    [
      'other package',
      { name: 'other', version: '0.2.0-rc.2' },
      'patched',
      false,
    ],
  ]
  for (const [label, manifest, content, passes] of cases) {
    const tree = await fixtureTree(manifest, content)
    try {
      const verified = verifyDshPatches(tree.anchor, [fixturePatch])
      if (passes) await verified
      else await assert.rejects(verified, isPatchMismatch, label)
    } finally {
      await tree.cleanup()
    }
  }
})

test('a file the patch names but the copy lacks is refused', async () => {
  const tree = await fixtureTree({ name: PACKAGE, version: '0.2.0-rc.2' })
  try {
    await assert.rejects(
      verifyDshPatches(tree.anchor, [
        {
          ...fixturePatch,
          files: { ...fixturePatch.files, 'lib/absent.js': '0'.repeat(64) },
        },
      ]),
      isPatchMismatch,
    )
  } finally {
    await tree.cleanup()
  }
})

test('a Host start refuses an unpatched runtime before claiming the home or spawning', async () => {
  const home = await mkdtemp(join(tmpdir(), 'corn-dsh-patch-home-'))
  let spawned = 0
  try {
    const supervisor = new DshHostSupervisor(home, {
      admission: { beforeSpawn: async () => {}, afterAuth: async () => {} },
      model: null,
      dshPatches: [
        { ...fixturePatch, files: { [FILE]: sha256('not what ships') } },
      ],
      spawnHost: () => {
        spawned++
        throw new Error('must not spawn')
      },
    })
    await assert.rejects(supervisor.start(), isPatchMismatch)
    assert.equal(spawned, 0)
    await assert.rejects(readFile(join(home, '.corn-bot-home.json')))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

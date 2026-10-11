import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  AVATAR_VISUAL_STATES,
  CORN_AVATAR_SHAPES,
  CORN_AVATAR_VARIANT_IDS,
} from '@corn-bot/contracts/avatar'

const root = new URL('../../../', import.meta.url)

interface LockedFile {
  readonly path: string
  readonly from: string
  readonly sha256: string
}

interface AssetLock {
  readonly sourceInputs: Readonly<Record<string, string>>
  readonly catalog: {
    readonly variants: readonly string[]
    readonly shapes: readonly string[]
    readonly states: readonly string[]
  }
  readonly migrated: readonly LockedFile[]
  readonly adapted: readonly LockedFile[]
}

const lock: AssetLock = JSON.parse(
  await readFile(new URL('design/corn-assets/ASSET_LOCK.json', root), 'utf8'),
)

const sha256 = async (path: string) =>
  createHash('sha256')
    .update(await readFile(new URL(path, root)))
    .digest('hex')

test('migrated Corn assets are byte-identical to the locked kit files', async () => {
  for (const entry of lock.migrated)
    assert.equal(await sha256(entry.path), entry.sha256, entry.path)
  const catalog = lock.migrated.find(
    (entry) => entry.from === 'assets/catalog.json',
  )
  assert.equal(catalog?.sha256, lock.sourceInputs['assets/catalog.json'])
})

test('adapted code matches its recorded hash; re-review provenance before updating it', async () => {
  for (const entry of lock.adapted) {
    assert.ok(lock.sourceInputs[entry.from], entry.from)
    assert.notEqual(entry.sha256, lock.sourceInputs[entry.from])
    assert.equal(await sha256(entry.path), entry.sha256, entry.path)
  }
})

test('every shipped avatar asset is listed in the lock', async () => {
  const listed = new Set(lock.migrated.map((entry) => entry.path))
  for (const folder of ['avatars', 'groups']) {
    const dir = `packages/ui/assets/${folder}`
    for (const file of await readdir(new URL(`${dir}/`, root)))
      assert.ok(listed.has(`${dir}/${file}`), `${dir}/${file}`)
  }
})

test('locked catalog agrees with the avatar contract', () => {
  assert.deepEqual(lock.catalog.variants, [...CORN_AVATAR_VARIANT_IDS])
  assert.deepEqual(lock.catalog.shapes, [...CORN_AVATAR_SHAPES])
  assert.deepEqual(lock.catalog.states, [...AVATAR_VISUAL_STATES])
})

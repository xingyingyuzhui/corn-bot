import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  BODY_SIZE,
  CANVAS_SIZE,
  generateAppIcons,
  ICON_SOURCE,
  iconsetEntries,
} from '../lib/app-icons.mjs'

const run = promisify(execFile)
const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const LOCK = 'design/corn-assets/ASSET_LOCK.json'
const macOnly = {
  skip: process.platform !== 'darwin' && 'needs sips and iconutil',
}

test('iconset covers 16–512 pt at @1x and @2x, as iconutil expects', () => {
  assert.deepEqual(
    iconsetEntries().map(({ name, pixels }) => `${name}:${pixels}`),
    [
      'icon_16x16.png:16',
      'icon_16x16@2x.png:32',
      'icon_32x32.png:32',
      'icon_32x32@2x.png:64',
      'icon_128x128.png:128',
      'icon_128x128@2x.png:256',
      'icon_256x256.png:256',
      'icon_256x256@2x.png:512',
      'icon_512x512.png:512',
      'icon_512x512@2x.png:1024',
    ],
  )
  assert.equal((CANVAS_SIZE - BODY_SIZE) / 2, 100)
})

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), 'corn-icons-'))
  for (const file of [LOCK, ICON_SOURCE]) {
    await mkdir(join(root, dirname(file)), { recursive: true })
    await cp(join(repo, file), join(root, file))
  }
  return root
}

test(
  'builds a 1024 canvas, a full iconset and an icns from the locked source',
  macOnly,
  async () => {
    const root = await fixtureRoot()
    try {
      const { canvas, icns, hashes } = await generateAppIcons(root)
      const { stdout } = await run('sips', [
        '-g',
        'pixelWidth',
        '-g',
        'hasAlpha',
        canvas,
      ])
      assert.match(stdout, /pixelWidth: 1024/)
      assert.match(stdout, /hasAlpha: yes/)
      const iconset = join(dirname(icns), 'Corn Bot.iconset')
      assert.deepEqual(
        (await readdir(iconset)).sort(),
        iconsetEntries()
          .map(({ name }) => name)
          .sort(),
      )
      assert.equal(Object.keys(hashes).length, 12)
      const again = await generateAppIcons(root)
      assert.deepEqual(again.hashes, hashes)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)

test(
  'refuses a source PNG that drifted from the asset lock',
  macOnly,
  async () => {
    const root = await fixtureRoot()
    try {
      await writeFile(join(root, ICON_SOURCE), 'not the locked icon')
      await assert.rejects(generateAppIcons(root), /drifted from ASSET_LOCK/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)

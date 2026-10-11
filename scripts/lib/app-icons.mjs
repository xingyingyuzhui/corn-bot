import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export const ICON_SOURCE = 'apps/desktop/assets/app-icon-source.png'
export const ICON_OUTPUT = '.build/icons'
export const ICON_NAME = 'Corn Bot'
export const CANVAS_SIZE = 1024
/** Apple macOS icon grid: the rounded body is 824 of 1024, leaving a 100 px transparent margin. */
export const BODY_SIZE = 824

const ICONSET_POINTS = [16, 32, 128, 256, 512]

/** The file names and pixel sizes `iconutil` expects inside a `.iconset`. */
export function iconsetEntries() {
  return ICONSET_POINTS.flatMap((points) => [
    { name: `icon_${points}x${points}.png`, pixels: points },
    { name: `icon_${points}x${points}@2x.png`, pixels: points * 2 },
  ])
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function lockedSourceHash(root) {
  const lock = JSON.parse(
    await readFile(join(root, 'design/corn-assets/ASSET_LOCK.json'), 'utf8'),
  )
  const entry = lock.migrated.find(({ path }) => path === ICON_SOURCE)
  if (!entry) throw new Error(`${ICON_SOURCE} is not in ASSET_LOCK.json`)
  return entry.sha256
}

async function sips(...args) {
  await exec('sips', args)
}

async function pixelSize(file) {
  const { stdout } = await exec('sips', [
    '-g',
    'pixelWidth',
    '-g',
    'pixelHeight',
    file,
  ])
  const read = (key) => Number(stdout.match(new RegExp(`${key}: (\\d+)`))?.[1])
  return { width: read('pixelWidth'), height: read('pixelHeight') }
}

/**
 * Builds the macOS App icon from the locked source PNG into `<root>/.build/icons`:
 * the source tile already carries its own rounded corners, so it is only scaled
 * onto Apple's grid and never masked a second time.
 */
export async function generateAppIcons(root) {
  if (process.platform !== 'darwin')
    throw new Error('App icon generation needs macOS sips and iconutil')
  const source = join(root, ICON_SOURCE)
  const expected = await lockedSourceHash(root)
  const actual = sha256(await readFile(source))
  if (actual !== expected)
    throw new Error(`${ICON_SOURCE} drifted from ASSET_LOCK.json (${actual})`)

  const { width, height } = await pixelSize(source)
  if (width !== height)
    throw new Error(`${ICON_SOURCE} must be square, got ${width}x${height}`)

  const output = join(root, ICON_OUTPUT)
  const iconset = join(output, `${ICON_NAME}.iconset`)
  const body = join(output, 'body.png')
  const canvas = join(output, `app-icon-${CANVAS_SIZE}.png`)
  const icns = join(output, `${ICON_NAME}.icns`)
  await rm(output, { recursive: true, force: true })
  await mkdir(iconset, { recursive: true })

  await sips('-Z', String(BODY_SIZE), source, '--out', body)
  await sips(
    '-p',
    String(CANVAS_SIZE),
    String(CANVAS_SIZE),
    body,
    '--out',
    canvas,
  )
  await rm(body)
  for (const { name, pixels } of iconsetEntries())
    await sips(
      '-z',
      String(pixels),
      String(pixels),
      canvas,
      '--out',
      join(iconset, name),
    )
  await exec('iconutil', ['-c', 'icns', iconset, '-o', icns])

  const hashes = {}
  for (const file of [canvas, icns])
    hashes[file.slice(root.length + 1)] = sha256(await readFile(file))
  for (const name of (await readdir(iconset)).sort())
    hashes[join(ICON_OUTPUT, `${ICON_NAME}.iconset`, name)] = sha256(
      await readFile(join(iconset, name)),
    )
  return { canvas, icns, hashes }
}

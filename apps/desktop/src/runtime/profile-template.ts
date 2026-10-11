import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import {
  CLAW_VERSION,
  DSH_VERSION,
} from '../../../../packages/contracts/src/runtime.ts'

export const TEMPLATE_MANIFEST = 'corn-profile-template.json'

interface TemplateManifest {
  schemaVersion: 1
  dshVersion: string
  clawVersion: string
  files: Record<string, string>
}

/** Regular files only: a template with links or special files is rejected. */
async function hashTree(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  async function walk(directory: string): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name)
      const key = relative(root, path).split(sep).join('/')
      if (key === TEMPLATE_MANIFEST) continue
      const stat = await lstat(path)
      if (stat.isDirectory()) await walk(path)
      else if (stat.isFile())
        files[key] = createHash('sha256')
          .update(await readFile(path))
          .digest('hex')
      else throw new Error(`Profile template has a non-regular entry: ${key}`)
    }
  }
  await walk(root)
  return files
}

export async function writeTemplateManifest(template: string): Promise<void> {
  const manifest: TemplateManifest = {
    schemaVersion: 1,
    dshVersion: DSH_VERSION,
    clawVersion: CLAW_VERSION,
    files: await hashTree(template),
  }
  await writeFile(
    join(template, TEMPLATE_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
}

export async function verifyTemplate(template: string): Promise<void> {
  const manifest = JSON.parse(
    await readFile(join(template, TEMPLATE_MANIFEST), 'utf8'),
  ) as TemplateManifest
  if (
    manifest.schemaVersion !== 1 ||
    manifest.dshVersion !== DSH_VERSION ||
    manifest.clawVersion !== CLAW_VERSION
  )
    throw new Error('Bundled profile template targets another runtime')
  const actual = await hashTree(template)
  const expected = manifest.files
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)])
  for (const key of keys)
    if (actual[key] !== expected[key])
      throw new Error(`Bundled profile template integrity mismatch: ${key}`)
}

/**
 * Seeds a missing profile from a verified template without a package manager or
 * network. The copy is staged and renamed so a crash never leaves a half profile.
 */
export async function materializeProfile(
  template: string,
  target: string,
): Promise<boolean> {
  if (existsSync(join(target, 'package.json'))) return false
  await verifyTemplate(template)
  const staging = `${target}.staging`
  await rm(staging, { recursive: true, force: true })
  await rm(target, { recursive: true, force: true })
  await mkdir(join(target, '..'), { recursive: true, mode: 0o700 })
  await cp(template, staging, {
    recursive: true,
    filter: (source) => !source.endsWith(`${sep}${TEMPLATE_MANIFEST}`),
  })
  await rename(staging, target)
  return true
}

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { RuntimeFailure } from './runtime-failure.ts'

/** One authorised patch applied to a published DSH package at install time. */
export interface DshPatch {
  readonly id: string
  readonly package: string
  readonly version: string
  /** Repository path of the pnpm patch file. */
  readonly patch: string
  /** SHA-256 of the patch file; pnpm records the same value as `patch_hash`. */
  readonly sha256: string
  /** SHA-256 of every shipped file the patch changes, after patching. */
  readonly files: Readonly<Record<string, string>>
}

/** Mirrors `dshPatches` in runtime.lock.json; a unit test keeps them equal. */
export const DSH_PATCHES: readonly DshPatch[] = [
  {
    id: 'U1',
    package: '@deepseek-ai/dsh-api-session-controller',
    version: '0.2.0-rc.2',
    patch: 'patches/@deepseek-ai__dsh-api-session-controller@0.2.0-rc.2.patch',
    sha256: '8873ba286b50882e1117d4ef5d0ba4e3cabd67b02ab47648f68d32da723e15dd',
    files: {
      'lib/index.js':
        '5b03b914e75c478d3468282abc6c7aeaff74700e626f3dd4ac39f412e6a619ca',
      'lib/typert.host.js':
        '87486ebe384e7b7a48b83c7e7650080e73f0728667b3e757d456e416ce644ecb',
      'lib/typert.remote-client.js':
        '0db7024a567bab8b5d3c20e8f2ba41de25c643edbf3205982d8e728f7274fb50',
      'lib/types/commands.js':
        '0cabcda35a2cdca441496373075e30ca026c363475e16d5ec198b678869a1055',
      'lib/types/types.d.ts':
        '0712b98e04f68a17a913df7aafaa55f91f175fa4f58b84bcf4d4a45f0deb712f',
    },
  },
]

/** Bundles the Corn profile loads from the DSH install; a copy they resolve must be patched too. */
const DSH_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

/** Node's lookup from `anchor`, as DSH resolves bundles; `exports` may hide `package.json`. */
function packageDir(name: string, anchor: string): string | undefined {
  for (const searchPath of createRequire(anchor).resolve.paths(name) ?? []) {
    const candidate = join(searchPath, name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
}

/** Every distinct copy of `name` reachable from the DSH CLI or its bundles. */
async function installedCopies(
  name: string,
  dshAnchor: string,
): Promise<ReadonlySet<string>> {
  // Node loads modules by real path, so lookups start where the files really are.
  const dsh = await realpath(dshAnchor)
  const anchors = [dsh]
  for (const bundle of DSH_BUNDLES) {
    const directory = packageDir(bundle, dsh)
    if (directory) anchors.push(join(await realpath(directory), 'package.json'))
  }
  const copies = new Set<string>()
  for (const anchor of anchors) {
    const directory = packageDir(name, anchor)
    if (directory) copies.add(await realpath(directory))
  }
  return copies
}

async function verifyCopy(directory: string, patch: DshPatch): Promise<void> {
  const manifest: unknown = JSON.parse(
    await readFile(join(directory, 'package.json'), 'utf8'),
  )
  const { name, version } = (manifest ?? {}) as Record<string, unknown>
  if (name !== patch.package || version !== patch.version)
    throw new RuntimeFailure(
      'runtime_patch_mismatch',
      `DSH patch ${patch.id} targets ${patch.package}@${patch.version}, found another package`,
    )
  for (const [file, expected] of Object.entries(patch.files)) {
    let actual: string
    try {
      actual = await sha256(join(directory, file))
    } catch (error) {
      throw new RuntimeFailure(
        'runtime_patch_mismatch',
        `DSH patch ${patch.id} file is unreadable: ${file}`,
        { cause: error },
      )
    }
    if (actual !== expected)
      throw new RuntimeFailure(
        'runtime_patch_mismatch',
        `DSH patch ${patch.id} is missing or altered: ${file}`,
      )
  }
}

/**
 * Every locked DSH patch must be present, byte for byte, in every copy of its
 * package the Host can load. Never repairs anything; a failure refuses start.
 */
export async function verifyDshPatches(
  dshAnchor: string,
  patches: readonly DshPatch[] = DSH_PATCHES,
): Promise<void> {
  for (const patch of patches) {
    const copies = await installedCopies(patch.package, dshAnchor)
    if (copies.size === 0)
      throw new RuntimeFailure(
        'runtime_patch_mismatch',
        `DSH patch ${patch.id} target ${patch.package} is not installed`,
      )
    for (const directory of copies) await verifyCopy(directory, patch)
  }
}

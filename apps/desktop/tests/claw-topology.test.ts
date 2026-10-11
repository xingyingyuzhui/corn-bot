import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import {
  composeEntries,
  parsePatchLayer,
  verifyClawTopology,
} from '../src/runtime/claw-topology.ts'
import { DSH_INSTALL_ANCHOR } from '../src/runtime/dsh-host-supervisor.ts'
import { RuntimeFailure } from '../src/runtime/runtime-failure.ts'

// The official composer and dialect shipped with the locked DSH runtime, used only as the parity oracle.
const dshRequire = createRequire(DSH_INSTALL_ANCHOR)
const includeEntry = dshRequire.resolve('@deepseek-ai/cordis-plugin-include')
const official: {
  applyEntryPatches(
    data: unknown[],
    patches: unknown[],
    warn: (message: string) => void,
  ): unknown[]
  entryListSchema: unknown
} = await import(pathToFileURL(includeEntry).href)
const jsYaml: { load(text: string, options: { schema: unknown }): unknown } =
  await import(
    pathToFileURL(createRequire(includeEntry).resolve('js-yaml')).href
  )

const ROWS: ReadonlySet<string> = new Set(['dsh-claw-suite', 'dsh-claw-gate'])
const SERVICES: ReadonlySet<string> = new Set(['tools', 'connection'])
const SUITE = [
  {
    insert: [
      { id: 'dsh-claw-suite', name: 'dsh-claw-suite' },
      { id: 'dsh-claw-gate', name: 'dsh-claw-gate' },
    ],
  },
]

function officialCompose(patches: readonly unknown[]): unknown[] {
  return official.applyEntryPatches([], structuredClone([...patches]), () => {})
}

async function officialBundleLayers(): Promise<unknown[]> {
  const patches: unknown[] = []
  for (const name of ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']) {
    const manifestPath = dshRequire.resolve(`${name}/package.json`)
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const declared = manifest.dsh.bundle.patch
    for (const file of typeof declared === 'string' ? [declared] : declared)
      patches.push(await readFile(join(dirname(manifestPath), file), 'utf8'))
  }
  return patches
}

const PARITY_CASES: ReadonlyArray<readonly [string, readonly unknown[]]> = [
  ['suite only', SUITE],
  [
    'override, name-mismatch skip and missing target',
    [
      ...SUITE,
      { id: 'dsh-claw-gate', isolate: { tools: true } },
      { id: 'dsh-claw-suite', name: 'other', disabled: true },
      { id: 'absent', disabled: true },
      { name: 'no-id' },
    ],
  ],
  [
    'group insert, config replacement and later patch of a group child',
    [
      ...SUITE,
      { insert: [{ id: 'g', name: 'cordis:group', group: true, config: [] }] },
      { id: 'g', insert: [{ id: 'dsh-claw-gate', name: 'dsh-claw-gate' }] },
      { id: 'dsh-claw-gate', intercept: { tools: {} } },
      { id: 'g', config: [{ id: 'x', name: 'x' }] },
      { id: 'x', disabled: true },
      { id: 'not-a-group', insert: [{ id: 'y', name: 'y' }] },
    ],
  ],
]

for (const [label, patches] of PARITY_CASES)
  test(`composition matches the official include: ${label}`, () => {
    assert.deepEqual(composeEntries(patches), officialCompose(patches))
  })

test('official bundle layers parse and compose identically', async () => {
  const texts = await officialBundleLayers()
  const ours = texts.flatMap((text) => parsePatchLayer(String(text)))
  const theirs = texts.flatMap(
    (text) =>
      jsYaml.load(String(text), {
        schema: official.entryListSchema,
      }) as unknown[],
  )
  assert.deepEqual(ours, theirs)
  const patches = [...ours, ...SUITE]
  assert.deepEqual(composeEntries(patches), officialCompose(patches))
  verifyClawTopology(composeEntries(patches), ROWS, SERVICES)
})

test('official model settings rows keep the topology valid', () => {
  const entries = composeEntries([
    ...SUITE,
    { insert: [{ id: 'agent-default-model', name: 'm', config: {} }] },
    {
      id: 'agent-default-model',
      config: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    },
  ])
  verifyClawTopology(entries, ROWS, SERVICES)
})

function refused(patches: readonly unknown[]): void {
  assert.throws(
    () => verifyClawTopology(composeEntries(patches), ROWS, SERVICES),
    (error: unknown) =>
      error instanceof RuntimeFailure && error.code === 'claw_disabled',
  )
}

test('a missing Claw row is refused', () => {
  refused([{ insert: [{ id: 'dsh-claw-suite', name: 'dsh-claw-suite' }] }])
})

test('a YAML alias inserting the same Claw row twice is refused', () => {
  const gate = { id: 'dsh-claw-gate', name: 'dsh-claw-gate' }
  refused([
    { insert: [{ id: 'dsh-claw-suite', name: 'dsh-claw-suite' }, gate] },
    { insert: [gate] },
  ])
})

test('a labelled realm on an unrelated entry for a Claw service is refused', () => {
  refused([
    ...SUITE,
    { insert: [{ id: 'z', name: 'z', isolate: { connection: 'r' } }] },
  ])
})

test('an expression isolate on an entry is refused as unverifiable', () => {
  refused([
    ...SUITE,
    { insert: [{ id: 'z', name: 'z', isolate: { __jsExpr: '{}' } }] },
    { id: 'z', isolate: 'tools' },
  ])
})

test('isolating a service Claw does not inject stays allowed', () => {
  verifyClawTopology(
    composeEntries([
      ...SUITE,
      {
        insert: [
          {
            id: 'p',
            name: 'cordis:group',
            group: true,
            isolate: { planMode: true },
            config: [],
          },
        ],
      },
    ]),
    ROWS,
    SERVICES,
  )
})

test('a patch that is not a mapping is refused', () => {
  assert.throws(() => composeEntries([...SUITE, 'x']), RuntimeFailure)
  assert.throws(() => composeEntries([{ insert: ['x'] }]), RuntimeFailure)
})

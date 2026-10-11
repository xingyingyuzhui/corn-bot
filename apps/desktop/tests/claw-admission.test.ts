import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { writeTemplateManifest } from '../src/runtime/profile-template.ts'
import {
  type HarnessOptions,
  RuntimeHarness,
  writeClawProfile,
} from './helpers/runtime-harness.ts'

const TIMEOUT = { timeout: 10_000 }
const SENTINEL = 'corn-data-sentinel-do-not-touch'

async function withHarness(
  options: HarnessOptions,
  run: (harness: RuntimeHarness) => Promise<void>,
): Promise<void> {
  const harness = await RuntimeHarness.create(options)
  try {
    await run(harness)
  } finally {
    await harness.dispose()
  }
}

async function plantSentinels(
  harness: RuntimeHarness,
): Promise<() => Promise<void>> {
  const files = [
    join(harness.profile, 'corn-sentinel.txt'),
    join(harness.home, 'corn-sentinel.txt'),
  ]
  const manifest = join(harness.profile, 'package.json')
  const before = existsSync(manifest) ? await readFile(manifest, 'utf8') : null
  for (const file of files) await writeFile(file, SENTINEL)
  return async () => {
    for (const file of files)
      assert.equal(await readFile(file, 'utf8'), SENTINEL, `${file} changed`)
    if (before !== null)
      assert.equal(
        await readFile(manifest, 'utf8'),
        before,
        'profile manifest changed',
      )
  }
}

/** A refused profile must fail terminally, release everything and keep its data. */
async function assertRefused(
  harness: RuntimeHarness,
  code: string,
  { spawned }: { spawned: boolean },
): Promise<void> {
  const verify = await plantSentinels(harness)
  for (let round = 0; round < 2; round++) {
    if (round === 1) harness.runtime = harness.build()
    await harness.control.start()
    assert.notEqual(harness.control.view.status, 'ready')
    assert.equal(harness.control.view.status, 'failed')
    assert.equal(harness.control.view.errorCode, code)
    assert.equal(harness.control.auth, undefined)
    assert.equal(harness.schedules.length, 0, 'terminal failures never retry')
    assert.equal(existsSync(join(harness.home, 'corn-host.lock')), false)
    for (const child of harness.children)
      assert.ok(child.exitCode !== null || child.signalCode !== null)
  }
  if (!spawned)
    assert.equal(harness.children.length, 0, 'refused before any spawn')
  await verify()
}

test(
  'Corn-created web profile without Claw never reaches ready',
  TIMEOUT,
  async () => {
    await withHarness({ profile: 'web' }, (harness) =>
      assertRefused(harness, 'claw_missing', { spawned: false }),
    )
  },
)

for (const [label, claw, code] of [
  [
    'suite version mismatch',
    { suiteVersion: '0.3.0-rc.1' },
    'claw_version_mismatch',
  ],
  ['Gate component missing', { omit: ['dsh-claw-gate'] }, 'claw_missing'],
  [
    'Registry component version mismatch',
    { componentVersions: { 'dsh-claw-registry': '0.2.9' } },
    'claw_version_mismatch',
  ],
  [
    'suite removed from dsh.profile.bundles',
    { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] },
    'claw_disabled',
  ],
  [
    'Gate row disabled in the profile patch layer',
    { profilePatch: '- id: dsh-claw-gate\n  disabled: true\n' },
    'claw_disabled',
  ],
  [
    'Registry row replaced in the profile patch layer',
    { profilePatch: '- id: dsh-claw-registry\n  name: some-other-plugin\n' },
    'claw_disabled',
  ],
  [
    'Gate row re-inserted under another plugin by the profile patch layer',
    {
      profilePatch:
        '- insert:\n    - id: dsh-claw-gate\n      name: some-other-plugin\n',
    },
    'claw_disabled',
  ],
  [
    'unverifiable profile patch layer',
    { profilePatch: "- id: dsh-claw-gate\n  config: !!js/function 'x'\n" },
    'claw_disabled',
  ],
  [
    'suite bundle no longer inserts the Gate row',
    {
      suitePatch:
        '- insert:\n    - id: dsh-claw-suite\n      name: dsh-claw-suite\n    - id: dsh-claw-registry\n      name: dsh-claw-registry\n',
    },
    'claw_disabled',
  ],
] as const) {
  test(`refuses a profile with ${label}`, TIMEOUT, async () => {
    await withHarness({ claw }, (harness) =>
      assertRefused(harness, code, { spawned: false }),
    )
  })
}

test(
  'a home-level patch disabling the suite row is refused',
  TIMEOUT,
  async () => {
    await withHarness({}, async (harness) => {
      await writeFile(
        join(harness.home, 'cordis.patch.yml'),
        '- id: dsh-claw-suite\n  disabled: true\n',
      )
      await assertRefused(harness, 'claw_disabled', { spawned: false })
    })
  },
)

for (const [mode, label] of [
  ['missing', 'absent Registry route'],
  ['invalid', 'malformed Registry revision'],
] as const) {
  test(
    `an ${label} stops the authenticated child and fails`,
    TIMEOUT,
    async () => {
      await withHarness({}, async (harness) => {
        harness.host.registry = mode
        await assertRefused(harness, 'claw_check_failed', { spawned: true })
        assert.ok(harness.children.every((child) => child.kills.length > 0))
      })
    },
  )
}

test(
  'a Claw bundle the Host reports as skipped never reaches ready',
  TIMEOUT,
  async () => {
    await withHarness({ autoReady: false }, async (harness) => {
      const started = harness.control.start()
      const child = await harness.nextChild()
      child.stderr.write(
        'dsh: skipping profile bundle "dsh-claw-suite": fixture reason\n',
      )
      await new Promise((resolve) => setImmediate(resolve))
      child.ready()
      await started
      assert.equal(harness.control.view.status, 'failed')
      assert.equal(harness.control.view.errorCode, 'claw_missing')
      assert.ok(child.kills.length > 0)
    })
  },
)

test(
  'recovery re-validates: a component removed before restart blocks ready',
  TIMEOUT,
  async () => {
    await withHarness({}, async (harness) => {
      await harness.control.start()
      assert.equal(harness.control.view.status, 'ready')
      await rm(join(harness.profile, 'node_modules', 'dsh-claw-gate'), {
        recursive: true,
      })
      harness.children[0]?.exit(null, 'SIGKILL')
      assert.equal(harness.control.view.status, 'recovering')
      harness.runRecovery()
      await new Promise<void>((resolve) => {
        const poll = () =>
          harness.control.view.status === 'recovering'
            ? setImmediate(poll)
            : resolve()
        poll()
      })
      assert.equal(harness.control.view.status, 'failed')
      assert.equal(harness.control.view.errorCode, 'claw_missing')
      assert.equal(harness.children.length, 1, 'no ungoverned restart')
    })
  },
)

test(
  'legitimate existing Corn profile is kept and reaches ready after checks',
  TIMEOUT,
  async () => {
    await withHarness({}, async (harness) => {
      const verify = await plantSentinels(harness)
      await harness.control.start()
      assert.equal(harness.control.view.status, 'ready')
      assert.equal(harness.control.view.errorCode, undefined)
      assert.equal(harness.host.registryCalls, 1)
      await verify()
    })
  },
)

test(
  'fresh home seeds from a verified bundled template, then checks Claw',
  TIMEOUT,
  async () => {
    const seed = await RuntimeHarness.create({ profile: 'none' })
    try {
      const template = join(seed.root, 'template')
      await writeClawProfile(template)
      await writeTemplateManifest(template)
      await withHarness(
        { profile: 'none', profileTemplate: template },
        async (harness) => {
          await harness.control.start()
          assert.equal(harness.control.view.status, 'ready')
          assert.ok(
            existsSync(join(harness.profile, 'node_modules', 'dsh-claw-gate')),
          )
          assert.equal(harness.host.registryCalls, 1)
        },
      )
    } finally {
      await seed.dispose()
    }
  },
)

test('the App entry is governed and never reaches the bootstrap Host', async () => {
  for (const file of ['../src/main.ts', '../src/runtime/startup-control.ts']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8')
    assert.doesNotMatch(
      source,
      /host-bootstrap|createBootstrapHost|admission:/u,
    )
  }
  const control = await readFile(
    new URL('../src/runtime/startup-control.ts', import.meta.url),
    'utf8',
  )
  assert.match(control, /createGovernedHost\(/u)
})

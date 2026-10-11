import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import type { RuntimeStatus } from '../../../packages/contracts/src/runtime.ts'
import {
  createGovernedHost,
  verifyClawProfile,
} from '../src/runtime/claw-runtime-check.ts'
import { writeTemplateManifest } from '../src/runtime/profile-template.ts'
import { RuntimeFailure } from '../src/runtime/runtime-failure.ts'
import { StartupControl } from '../src/runtime/startup-control.ts'
import {
  type HarnessOptions,
  RuntimeHarness,
  within,
  writeClawProfile,
} from './helpers/runtime-harness.ts'

const TIMEOUT = { timeout: 10_000 }
const SENTINEL = 'corn-data-sentinel-do-not-touch'

/** Event-loop turns until the control leaves `status`; bounded only for liveness. */
function waitWhile(
  harness: RuntimeHarness,
  status: RuntimeStatus,
): Promise<void> {
  return within(
    new Promise<void>((resolve) => {
      const poll = () =>
        harness.control.view.status === status ? setImmediate(poll) : resolve()
      poll()
    }),
    `leaving ${status}`,
  )
}

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

/** Second-round F1: Loader topology that leaves a Claw row unmounted or out of its service scope. */
const TOPOLOGY_ATTACKS: ReadonlyArray<readonly [string, string]> = [
  [
    'Gate row isolating its tools dependency (F1 repro)',
    '- id: dsh-claw-gate\n  isolate:\n    tools: true\n',
  ],
  [
    'Gate row joining a labelled connection realm',
    '- id: dsh-claw-gate\n  isolate:\n    connection: corn-attack-realm\n',
  ],
  [
    'Gate row injecting a service nobody provides',
    '- id: dsh-claw-gate\n  inject:\n    - cornNeverProvided\n',
  ],
  [
    'Gate row intercepting its tools service',
    '- id: dsh-claw-gate\n  intercept:\n    tools: {}\n',
  ],
  ['Gate row turned into a group', '- id: dsh-claw-gate\n  group: true\n'],
  [
    'Gate row given unapproved config',
    '- id: dsh-claw-gate\n  config:\n    enabled: false\n',
  ],
  [
    'Gate row disabled by a js expression',
    '- id: dsh-claw-gate\n  disabled: !!js "true"\n',
  ],
  [
    'Gate re-inserted at the top level under its own name',
    '- insert:\n    - id: dsh-claw-gate\n      name: dsh-claw-gate\n',
  ],
  [
    'Gate re-mounted inside an isolating group (ancestor)',
    '- insert:\n    - id: corn-attack-realm\n      name: cordis:group\n      group: true\n      isolate:\n        tools: true\n      config:\n        - id: dsh-claw-gate\n          name: dsh-claw-gate\n',
  ],
  [
    'Gate re-mounted by inserting into a group',
    '- insert:\n    - id: corn-attack-group\n      name: cordis:group\n      group: true\n      config: []\n- id: corn-attack-group\n  insert:\n    - id: dsh-claw-gate\n      name: dsh-claw-gate\n',
  ],
  [
    'Registry re-mounted by replacing a group config',
    '- insert:\n    - id: corn-attack-group\n      name: cordis:group\n      group: true\n      config: []\n- id: corn-attack-group\n  config:\n    - id: dsh-claw-registry\n      name: dsh-claw-registry\n',
  ],
  [
    'a second Gate instance under another id',
    '- insert:\n    - id: corn-attack-gate\n      name: dsh-claw-gate\n',
  ],
  [
    'the tools provider isolated away from the Gate (dependency)',
    '- id: tools\n  isolate:\n    tools: true\n',
  ],
  [
    'a preset plugin group isolating tools (dependency)',
    "- insert:\n    - id: corn-attack-preset\n      name: '@deepseek-ai/dsh-agent-preset'\n      config:\n        id: corn-attack\n        plugins:\n          - id: corn-attack-realm\n            name: cordis:group\n            group: true\n            isolate:\n              tools: true\n            config: []\n",
  ],
]

for (const [label, patch] of TOPOLOGY_ATTACKS) {
  test(`refuses a profile patch layer with ${label}`, TIMEOUT, async () => {
    await withHarness({ claw: { profilePatch: patch } }, (harness) =>
      assertRefused(harness, 'claw_disabled', { spawned: false }),
    )
  })
}

test(
  'a home-level patch isolating the Gate tools dependency is refused',
  TIMEOUT,
  async () => {
    await withHarness({}, async (harness) => {
      await writeFile(
        join(harness.home, 'cordis.patch.yml'),
        '- id: dsh-claw-gate\n  isolate:\n    tools: true\n',
      )
      await assertRefused(harness, 'claw_disabled', { spawned: false })
    })
  },
)

test(
  'a later bundle layer isolating the Gate is refused',
  TIMEOUT,
  async () => {
    await withHarness(
      {
        claw: {
          extraBundle: {
            name: 'corn-attack-bundle',
            patch: '- id: dsh-claw-gate\n  isolate:\n    tools: true\n',
          },
        },
      },
      (harness) => assertRefused(harness, 'claw_disabled', { spawned: false }),
    )
  },
)

test(
  'an unverifiable later bundle layer is refused, never skipped',
  TIMEOUT,
  async () => {
    await withHarness(
      {
        claw: {
          extraBundle: {
            name: 'corn-attack-bundle',
            patch: '- id: dsh-claw-gate\n  isolate: !!js/function "x"\n',
          },
        },
      },
      (harness) => assertRefused(harness, 'claw_disabled', { spawned: false }),
    )
  },
)

test(
  'a launcher overlay isolating the Gate is refused before spawn',
  TIMEOUT,
  async () => {
    await withHarness({}, async (harness) => {
      const overlay = join(harness.home, 'attack.patch.yml')
      await writeFile(
        overlay,
        '- id: dsh-claw-gate\n  isolate:\n    tools: true\n',
      )
      await assert.rejects(
        verifyClawProfile(harness.profile, harness.home, [overlay]),
        (error: unknown) =>
          error instanceof RuntimeFailure && error.code === 'claw_disabled',
      )
      await writeFile(overlay, '[]\n')
      await verifyClawProfile(harness.profile, harness.home, [overlay])
    })
  },
)

test(
  'a profile with official model settings saved still passes admission',
  TIMEOUT,
  async () => {
    // Rows written by the official settings services (`agent-default-model`, `llm-pi-ai`).
    const profilePatch = [
      '- id: agent-default-model',
      '  config:',
      '    provider: deepseek-official',
      '    model: deepseek-v4-pro',
      '    reasoningEffort: max',
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      corn-audit-gateway:',
      '        displayName: Corn audit gateway',
      '        api: openai-completions',
      "        baseURL: 'http://127.0.0.1:9/v1'",
      '        apiKeyEnv: CORN_AUDIT_FAKE_API_KEY',
      '        models:',
      '          - id: corn-audit-model',
      '',
    ].join('\n')
    await withHarness({ claw: { profilePatch } }, async (harness) => {
      await harness.control.start()
      assert.equal(harness.control.view.status, 'ready')
      assert.equal(harness.control.view.errorCode, undefined)
    })
  },
)

for (const [mode, label] of [
  ['missing', 'answers 404 (Gate not mounted)'],
  ['error', 'answers an error status'],
  ['not-json', 'answers a non-JSON body'],
  ['not-ok', 'answers a failed envelope'],
  ['no-items', 'answers without items'],
  ['items-not-array', 'answers items that are not a list'],
  ['over-limit', 'answers more items than requested'],
] as const) {
  test(
    `Registry ok but the Gate audit route ${label}: never ready`,
    TIMEOUT,
    async () => {
      await withHarness({}, async (harness) => {
        harness.host.gate = mode
        await assertRefused(harness, 'claw_check_failed', { spawned: true })
        assert.ok(harness.host.registryCalls >= 1)
        assert.ok(harness.host.gateCalls >= 1)
        assert.ok(harness.children.every((child) => child.kills.length > 0))
      })
    },
  )
}

test(
  'the Gate probe asks for at most one audit row, after the Registry',
  TIMEOUT,
  async () => {
    await withHarness({}, async (harness) => {
      await harness.control.start()
      assert.equal(harness.control.view.status, 'ready')
      assert.equal(harness.host.registryCalls, 1)
      assert.equal(harness.host.gateCalls, 1)
      assert.deepEqual(harness.host.gateBodies, [{ limit: 1 }])
    })
  },
)

test(
  'a hanging Gate check is cancelled by stop without a late ready',
  TIMEOUT,
  async () => {
    await withHarness({}, async (harness) => {
      harness.host.gate = 'hang'
      const started = harness.control.start()
      await harness.host.gateArrived()
      assert.equal(harness.control.view.status, 'starting')
      await within(harness.control.shutdown(), 'shutdown')
      await within(started, 'start')
      harness.host.releaseGate()
      assert.equal(harness.control.view.status, 'stopped')
      assert.equal(harness.control.auth, undefined)
      assert.equal(existsSync(join(harness.home, 'corn-host.lock')), false)
      assert.ok(
        harness.children.every(
          (child) => child.exitCode !== null || child.signalCode !== null,
        ),
      )
    })
  },
)

test(
  'a child exit during the Gate check never commits ready; recovery re-checks the Gate',
  TIMEOUT,
  async () => {
    await withHarness({}, async (harness) => {
      harness.host.gate = 'hang'
      const started = harness.control.start()
      await harness.host.gateArrived()
      const child = harness.children[0]
      assert.ok(child)
      child.exit(1)
      await within(started, 'start')
      harness.host.releaseGate()
      assert.equal(harness.control.view.status, 'recovering')
      assert.equal(harness.control.auth, undefined)
      assert.equal(existsSync(join(harness.home, 'corn-host.lock')), false)
      harness.host.gate = 'missing'
      harness.runRecovery()
      await harness.nextChild()
      await harness.nextChild()
      await harness.host.gateArrived()
      await waitWhile(harness, 'recovering')
      assert.equal(harness.control.view.status, 'failed')
      assert.equal(harness.control.view.errorCode, 'claw_check_failed')
      assert.equal(harness.host.gateCalls, 2)
    })
  },
)

test(
  'a Gate check that never answers fails terminally at its deadline',
  TIMEOUT,
  async () => {
    await withHarness({}, async (harness) => {
      harness.host.gate = 'hang'
      const { schedule, ...seams } = harness.seams()
      const host = createGovernedHost(harness.home, {
        ...seams,
        model: null,
        clawCheckTimeoutMs: 50,
      })
      const control = new StartupControl({ host, schedule })
      try {
        await within(control.start(), 'start')
        assert.equal(control.view.status, 'failed')
        assert.equal(control.view.errorCode, 'claw_check_failed')
        assert.equal(harness.schedules.length, 0)
        assert.equal(existsSync(join(harness.home, 'corn-host.lock')), false)
        assert.ok(harness.children.every((child) => child.kills.length > 0))
      } finally {
        await control.shutdown()
      }
    })
  },
)

test(
  'recovery re-validates the Gate: a Gate gone after a crash blocks ready',
  TIMEOUT,
  async () => {
    await withHarness({}, async (harness) => {
      await harness.control.start()
      assert.equal(harness.control.view.status, 'ready')
      harness.host.gate = 'missing'
      harness.children[0]?.exit(null, 'SIGKILL')
      assert.equal(harness.control.view.status, 'recovering')
      harness.runRecovery()
      await waitWhile(harness, 'recovering')
      assert.equal(harness.control.view.status, 'failed')
      assert.equal(harness.control.view.errorCode, 'claw_check_failed')
      assert.equal(harness.host.gateCalls, 2)
      assert.equal(existsSync(join(harness.home, 'corn-host.lock')), false)
    })
  },
)

test(
  'crash recovery of a legitimate profile re-checks the Gate and returns to ready',
  TIMEOUT,
  async () => {
    await withHarness({}, async (harness) => {
      await harness.control.start()
      harness.children[0]?.exit(null, 'SIGKILL')
      harness.runRecovery()
      await waitWhile(harness, 'recovering')
      assert.equal(harness.control.view.status, 'ready')
      assert.equal(harness.children.length, 2)
      assert.equal(harness.host.gateCalls, 2)
    })
  },
)

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

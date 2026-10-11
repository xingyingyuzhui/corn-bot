import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writeTemplateManifest } from '../../apps/desktop/src/runtime/profile-template.ts'
import {
  probeDiscoveryCancellation,
  startDiscoveryStub,
} from '../lib/model-audit-cancellation.mjs'
import {
  AuditRefusal,
  assertCredentialFreeTemplate,
  auditHostEnvironment,
  createAuditLab,
  FAKE,
  refuseExternalHome,
  VersionMismatch,
  verifyRuntimeVersions,
} from '../lib/model-audit-fixtures.mjs'
import { runAudit, scanForFakeKeys } from '../lib/model-audit-report.mjs'

const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const AUDIT = join(repo, 'scripts/audit/model-config-api-audit.mjs')
const PACKAGED = join(repo, 'scripts/audit/packaged-model-config-probe.mjs')
const FAST = { readinessMs: 5_000, graceMs: 300, killMs: 2_000, closeMs: 1_000 }

/** A stand-in Host: prints DSH's readiness line, optionally its environment, then idles. */
function fakeHost({ ignoreTerm = false, dumpEnv = false, exitCode } = {}) {
  const source = [
    exitCode === undefined ? '' : `process.exit(${exitCode})`,
    ignoreTerm ? "process.on('SIGTERM', () => {})" : '',
    dumpEnv ? 'console.log(JSON.stringify(process.env))' : '',
    "console.log('dsh web: http://127.0.0.1:9/?token=corn-test')",
    'setInterval(() => {}, 1000)',
  ].join(';')
  return { command: process.execPath, args: ['-e', source] }
}

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function scratch(t) {
  const dir = await mkdtemp(join(tmpdir(), 'corn-audit-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** A Corn home someone already uses: owner marker, `.env`, credentials and a deliberately broken profile. */
async function plantExternalHome(dir) {
  const home = join(dir, 'existing-dev-home')
  const profile = join(home, 'profiles', 'corn-dev')
  await mkdir(profile, { recursive: true, mode: 0o700 })
  const files = {
    '.corn-bot-home.json': `${JSON.stringify({ owner: 'corn-bot', schemaVersion: 1 })}\n`,
    '.env': 'CORN_SENTINEL_ENV=corn-sentinel-env-value\n',
    '.credentials.yaml':
      'version: 1\nrefs:\n  CORN_SENTINEL: corn-sentinel-cred\n',
    'profiles/corn-dev/cordis.patch.yml': '- id: corn-sentinel-row\n',
    'profiles/corn-dev/package.json': '{ not json: corn-sentinel',
  }
  for (const [path, text] of Object.entries(files)) {
    await writeFile(join(home, path), text)
    await chmod(join(home, path), 0o600)
  }
  return home
}

async function fingerprint(root) {
  const rows = []
  async function walk(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name)
      const info = await stat(path)
      const key = path.slice(root.length)
      if (info.isDirectory()) {
        rows.push(`${key}/ ${(info.mode & 0o777).toString(8)}`)
        await walk(path)
      } else
        rows.push(
          `${key} ${(info.mode & 0o777).toString(8)} ${info.mtimeMs} ${(await readFile(path)).toString('base64')}`,
        )
    }
  }
  await walk(root)
  return rows.join('\n')
}

function runScript(script, args, env) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [script, ...args],
      { cwd: repo, env, timeout: 30_000 },
      (error, stdout, stderr) =>
        resolve({ code: error ? (error.code ?? 'killed') : 0, stdout, stderr }),
    )
  })
}

const cleanEnv = () => {
  const env = { ...process.env }
  delete env.CORN_DSH_HOME
  return env
}

test('the API audit refuses an external home before reading, writing or spawning', async (t) => {
  const dir = await scratch(t)
  const home = await plantExternalHome(dir)
  const before = await fingerprint(home)
  for (const [args, env] of [
    [[], { ...cleanEnv(), CORN_DSH_HOME: home }],
    [[home], cleanEnv()],
    [['--home', home], cleanEnv()],
  ]) {
    const started = Date.now()
    const result = await runScript(AUDIT, args, env)
    assert.equal(result.code, 2, result.stderr)
    assert.match(result.stderr, /refus/iu)
    assert.doesNotMatch(result.stdout, /AUDIT/u)
    assert.ok(Date.now() - started < 15_000)
    assert.equal(await fingerprint(home), before)
  }
  assert.deepEqual((await readdir(home)).sort(), [
    '.corn-bot-home.json',
    '.credentials.yaml',
    '.env',
    'profiles',
  ])
})

test('the packaged probe refuses an external home or a non-app argument', async (t) => {
  const dir = await scratch(t)
  const home = await plantExternalHome(dir)
  const before = await fingerprint(home)
  for (const [args, env] of [
    [[join(dir, 'Corn Bot.app')], { ...cleanEnv(), CORN_DSH_HOME: home }],
    [[home], cleanEnv()],
    [[join(dir, 'Corn Bot.app'), home], cleanEnv()],
  ]) {
    const result = await runScript(PACKAGED, args, env)
    assert.equal(result.code, 2, result.stderr)
    assert.match(result.stderr, /refus/iu)
    assert.equal(await fingerprint(home), before)
  }
})

test('refusal is decided from argv and env strings alone', () => {
  assert.throws(
    () => refuseExternalHome([], { CORN_DSH_HOME: '/nonexistent/x' }),
    AuditRefusal,
  )
  assert.throws(() => refuseExternalHome(['/x'], {}), AuditRefusal)
  assert.throws(() => refuseExternalHome(['--home=/x'], {}), AuditRefusal)
  assert.deepEqual(refuseExternalHome([], {}), [])
  assert.deepEqual(
    refuseExternalHome(['/a/Corn Bot.app'], {}, { positional: 1 }),
    ['/a/Corn Bot.app'],
  )
})

test('a lab owns a fresh, claimed, locked home and destroys it completely', async (t) => {
  const parent = await scratch(t)
  const lab = await createAuditLab({ label: 'unit', parent, timing: FAST })
  assert.ok(lab.root.startsWith(await realpath(parent)))
  assert.equal(lab.home, join(lab.root, 'home'))
  const marker = JSON.parse(
    await readFile(join(lab.home, '.corn-bot-home.json'), 'utf8'),
  )
  assert.equal(marker.owner, 'corn-bot')
  assert.equal(marker.purpose, 'model-config-audit')
  assert.ok(existsSync(join(lab.home, 'corn-host.lock')))
  assert.equal(((await stat(lab.home)).mode & 0o777).toString(8), '700')
  const cleanup = await lab.destroy()
  assert.equal(cleanup.removed, true)
  assert.equal(existsSync(lab.root), false)
  assert.deepEqual(await readdir(parent), [])
})

test('a spawn error rejects promptly and leaves no lab behind', async (t) => {
  const parent = await scratch(t)
  const lab = await createAuditLab({ label: 'unit', parent, timing: FAST })
  await assert.rejects(
    lab.startHost({ command: join(parent, 'missing-host'), args: [] }),
    /spawn|ENOENT/u,
  )
  await lab.destroy()
  assert.deepEqual(await readdir(parent), [])
})

test('a Host that exits before readiness rejects and leaves no lab behind', async (t) => {
  const parent = await scratch(t)
  const lab = await createAuditLab({ label: 'unit', parent, timing: FAST })
  await assert.rejects(
    lab.startHost(fakeHost({ exitCode: 3 })),
    /exited before readiness/u,
  )
  await lab.destroy()
  assert.deepEqual(await readdir(parent), [])
})

test('a Host ignoring SIGTERM is killed within the bounded grace', async (t) => {
  const parent = await scratch(t)
  const lab = await createAuditLab({ label: 'unit', parent, timing: FAST })
  const host = await lab.startHost(fakeHost({ ignoreTerm: true }))
  assert.ok(alive(host.pid))
  const started = Date.now()
  const cleanup = await lab.destroy()
  assert.ok(Date.now() - started < 4_000)
  assert.equal(cleanup.hostsStopped, 1)
  assert.equal(alive(host.pid), false)
  assert.deepEqual(await readdir(parent), [])
})

test('no ambient or real key reaches the Host environment', async (t) => {
  const parent = await scratch(t)
  const ambient = {
    DEEPSEEK_API_KEY: 'corn-ambient-sentinel-deepseek',
    OPENAI_API_KEY: 'corn-ambient-sentinel-openai',
    CORN_MODEL_API_KEY: 'corn-ambient-sentinel-model',
    CORN_MODEL_ENV_FILE: '/nonexistent/model.env',
    DSH_HOME: '/nonexistent/dsh',
  }
  const saved = Object.keys(ambient).map((key) => [key, process.env[key]])
  Object.assign(process.env, ambient)
  t.after(() => {
    for (const [key, value] of saved)
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
  })
  const lab = await createAuditLab({ label: 'unit', parent, timing: FAST })
  try {
    const host = await lab.startHost({
      ...fakeHost({ dumpEnv: true }),
      env: { CORN_AUDIT_ENV_API_KEY: FAKE.env },
    })
    const seen = JSON.parse(host.output.join('').split('\n')[0])
    for (const value of Object.values(ambient))
      assert.ok(!Object.values(seen).includes(value))
    assert.equal(seen.DSH_HOME, lab.home)
    assert.equal(seen.CORN_AUDIT_ENV_API_KEY, FAKE.env)
    assert.throws(
      () => auditHostEnvironment(lab.home, { DEEPSEEK_API_KEY: FAKE.env }),
      /CORN_AUDIT_/u,
    )
    assert.throws(
      () =>
        auditHostEnvironment(lab.home, {
          CORN_AUDIT_ENV_API_KEY: 'sk-live-not-a-fake',
        }),
      /fake/iu,
    )
  } finally {
    await lab.destroy()
  }
  assert.deepEqual(await readdir(parent), [])
})

async function fakeTemplate(dir, { clawVersion = '0.3.0-rc.2', extra } = {}) {
  const template = join(dir, 'template')
  const claw = join(template, 'node_modules', 'dsh-claw-suite')
  await mkdir(claw, { recursive: true })
  await writeFile(
    join(template, 'package.json'),
    `${JSON.stringify({ name: 'dsh-profile-corn-dev', dependencies: { 'dsh-claw-suite': clawVersion } })}\n`,
  )
  await writeFile(join(template, 'cordis.yml'), '[]\n')
  await writeFile(join(template, 'cordis.patch.yml'), '[]\n')
  await writeFile(
    join(claw, 'package.json'),
    `${JSON.stringify({ name: 'dsh-claw-suite', version: clawVersion })}\n`,
  )
  if (extra) await writeFile(join(template, extra), 'corn-sentinel\n')
  await writeTemplateManifest(template)
  return template
}

test('profiles come only from a verified, credential-free template', async (t) => {
  const parent = await scratch(t)
  const dirty = await fakeTemplate(join(parent, 'dirty'), {
    extra: '.credentials.yaml',
  })
  await assert.rejects(assertCredentialFreeTemplate(dirty), /credential-free/u)
  const clean = await fakeTemplate(join(parent, 'clean'))
  await assertCredentialFreeTemplate(clean)
  const lab = await createAuditLab({ label: 'unit', parent, timing: FAST })
  try {
    await assert.rejects(lab.seedProfile(dirty), /credential-free/u)
    await lab.seedProfile(clean)
    assert.ok(existsSync(join(lab.profile, 'package.json')))
  } finally {
    await lab.destroy()
  }
})

test('a Claw or DSH version mismatch fails safely and destroys the lab', async (t) => {
  const parent = await scratch(t)
  const template = await fakeTemplate(join(parent, 'old'), {
    clawVersion: '0.2.9',
  })
  const reportPath = join(parent, 'report.json')
  const labs = join(parent, 'labs')
  await mkdir(labs)
  const report = await runAudit({
    label: 'unit',
    reportPath,
    labParent: labs,
    timing: FAST,
    required: ['never'],
    body: async (lab) => {
      await lab.seedProfile(template)
      await verifyRuntimeVersions({ profile: lab.profile })
    },
  })
  assert.equal(report.status, 'failed')
  assert.equal(report.exitCode, 1)
  assert.match(report.failure, /version/iu)
  assert.deepEqual(await readdir(labs), [])
  const dshManifest = join(parent, 'dsh-package.json')
  await writeFile(dshManifest, JSON.stringify({ version: '0.0.0' }))
  await assert.rejects(
    verifyRuntimeVersions({
      profile: join(parent, 'clean-profile'),
      dshManifest,
    }),
    VersionMismatch,
  )
})

test('a failing configuration step stops the Host, releases the lock and replaces a stale verified report', async (t) => {
  const parent = await scratch(t)
  const reportPath = join(parent, 'report.json')
  await writeFile(reportPath, JSON.stringify({ status: 'passed' }))
  const labs = join(parent, 'labs')
  await mkdir(labs)
  let pid
  const report = await runAudit({
    label: 'unit',
    reportPath,
    labParent: labs,
    timing: FAST,
    required: ['global-default-write'],
    body: async (lab) => {
      pid = (await lab.startHost(fakeHost({ ignoreTerm: true }))).pid
      throw new Error('settings/update rejected')
    },
  })
  assert.equal(report.status, 'failed')
  assert.equal(report.exitCode, 1)
  assert.equal(report.cleanup.ok, true)
  assert.equal(alive(pid), false)
  assert.deepEqual(await readdir(labs), [])
  const stored = JSON.parse(await readFile(reportPath, 'utf8'))
  assert.equal(stored.status, 'failed')
})

test('a failed cancellation check exits non-zero and leaves no Host, stub, lock or home', async (t) => {
  const parent = await scratch(t)
  const labs = join(parent, 'labs')
  await mkdir(labs)
  let pid
  let port
  const started = Date.now()
  const report = await runAudit({
    label: 'unit',
    reportPath: join(parent, 'report.json'),
    labParent: labs,
    timing: FAST,
    required: ['discovery-cancellation'],
    body: async (lab) => {
      pid = (await lab.startHost(fakeHost())).pid
      const stub = await startDiscoveryStub()
      lab.track(() => stub.close())
      port = stub.port
      await probeDiscoveryCancellation({
        stub,
        arrivalMs: 300,
        abortMs: 300,
        closeMs: 300,
        call: (signal) =>
          new Promise((_, reject) =>
            signal.addEventListener(
              'abort',
              () => reject(new DOMException('aborted', 'AbortError')),
              { once: true },
            ),
          ),
      })
    },
  })
  assert.ok(Date.now() - started < 8_000)
  assert.equal(report.status, 'failed')
  assert.equal(report.exitCode, 1)
  assert.equal(
    report.capabilities['discovery-cancellation'].reason,
    'upstream-never-reached',
  )
  assert.equal(report.cleanup.ok, true)
  assert.equal(alive(pid), false)
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`))
  assert.deepEqual(await readdir(labs), [])
})

test('success requires every listed capability and removes the lab', async (t) => {
  const parent = await scratch(t)
  const labs = join(parent, 'labs')
  await mkdir(labs)
  const reportPath = join(parent, 'report.json')
  const skipped = await runAudit({
    label: 'unit',
    reportPath,
    labParent: labs,
    timing: FAST,
    required: ['a', 'b'],
    body: async (_lab, audit) => audit.pass('a', {}),
  })
  assert.equal(skipped.status, 'failed')
  const passed = await runAudit({
    label: 'unit',
    reportPath,
    labParent: labs,
    timing: FAST,
    required: ['a'],
    body: async (lab, audit) => {
      await lab.startHost(fakeHost())
      audit.record('step', { observed: 1 })
      audit.pass('a', { observed: true })
    },
  })
  assert.equal(passed.status, 'passed')
  assert.equal(passed.exitCode, 0)
  assert.equal(passed.cleanup.removed, true)
  assert.deepEqual(await readdir(labs), [])
})

test('a cleanup failure exits non-zero and never claims cleanup', async (t) => {
  const parent = await scratch(t)
  const labs = join(parent, 'labs')
  await mkdir(labs)
  const reportPath = join(parent, 'report.json')
  const report = await runAudit({
    label: 'unit',
    reportPath,
    labParent: labs,
    timing: FAST,
    required: ['a'],
    body: async (lab, audit) => {
      audit.pass('a', {})
      await writeFile(
        join(lab.home, '.corn-bot-home.json'),
        JSON.stringify({ owner: 'corn-bot', purpose: 'someone-else' }),
      )
    },
  })
  assert.equal(report.status, 'failed')
  assert.equal(report.exitCode, 1)
  assert.equal(report.cleanup.ok, false)
  assert.equal(report.cleanup.removed, false)
})

test('fake keys are caught in wire, output, report and the home tree', async (t) => {
  const parent = await scratch(t)
  await writeFile(join(parent, 'stray.yaml'), `ref: ${FAKE.file}\n`)
  assert.deepEqual(
    await scanForFakeKeys({
      texts: { wire: 'ok', 'host-output': `x ${FAKE.discovery}` },
      tree: parent,
    }),
    ['host-output', '/stray.yaml'],
  )
  const labs = join(parent, 'labs')
  await mkdir(labs)
  const reportPath = join(parent, 'report.json')
  const report = await runAudit({
    label: 'unit',
    reportPath,
    labParent: labs,
    timing: FAST,
    required: ['a'],
    body: async (_lab, audit) => {
      audit.pass('a', {})
      audit.record('oops', { echoed: FAKE.env })
    },
  })
  assert.equal(report.status, 'failed')
  const stored = await readFile(reportPath, 'utf8')
  for (const fake of Object.values(FAKE)) assert.ok(!stored.includes(fake))
})

import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { createGovernedHost } from '../apps/desktop/src/runtime/claw-runtime-check.ts'
import { record } from '../packages/dsh-adapter/src/remote-error.ts'
import {
  FAKE_KEY_ENV,
  FAKE_MODEL,
  FAKE_MODEL_KEY,
  FAKE_PROVIDER,
  startFakeModel,
} from './lib/fake-model-server.mjs'
import { ModelHarness } from './lib/model-session.mjs'
import { buildProfileTemplate } from './lib/profile-template-build.mjs'

// Real-Host gate for DSH patch U1 (session-only model selection). Headless and
// free: the governed Host runs under a loopback-only sandbox against a scripted
// loopback model with two models, never a real provider. A verified profile
// template comes from `CORN_PROFILE_TEMPLATE` or is built first (needs the
// pinned Claw release). Exports ids, model names and counts only.
const RUN_ROOT = join(homedir(), '.corn-bot-dev', 'wt-dsh-u1')
const ALT_MODEL = `${FAKE_MODEL}-alt`
const TURN_TIMEOUT = 60_000
const PROMPT = 'Connection test. Reply with one short sentence.'
const NO_NETWORK = `(version 1)
(allow default)
(deny network-outbound)
(allow network-outbound (remote ip "localhost:*"))
(allow network-outbound (remote unix-socket))`
/** `cornHostEnvironment` keys; the Host must receive nothing else. */
const HOST_ENV = new Set([
  'DSH_HOME',
  'DSH_TELEMETRY_DISABLED',
  'PATH',
  'HOME',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
])
const SENSITIVE = /KEY|TOKEN|SECRET|PASSW|CREDENTIAL|AUTH|COOKIE|PROXY/i

const scrub = (env) =>
  Object.fromEntries(Object.entries(env).filter(([k]) => !SENSITIVE.test(k)))
const hostEnvKeys = []
function sandboxedSpawn(command, args, options = {}) {
  const env = scrub(options.env ?? {})
  hostEnvKeys.push(Object.keys(env).sort())
  return spawn('sandbox-exec', ['-p', NO_NETWORK, command, ...args], {
    ...options,
    env,
  })
}

async function sandboxDeniesNetwork() {
  const probe = `require('net').connect({host:'1.1.1.1',port:443}).on('connect',()=>{console.log('connected');process.exit(0)}).on('error',e=>{console.log(e.code);process.exit(0)})`
  const { stdout } = await promisify(execFile)('sandbox-exec', [
    '-p',
    NO_NETWORK,
    process.execPath,
    '-e',
    probe,
  ])
  assert.equal(stdout.trim(), 'EPERM', 'Sandbox must deny outbound network')
}

function providerPatch(baseURL) {
  const model = (id) => ({
    id,
    name: id,
    reasoningEfforts: false,
    contextWindow: 65_536,
    maxTokens: 4_096,
  })
  return [
    {
      id: 'llm-pi-ai',
      config: {
        providers: {
          [FAKE_PROVIDER]: {
            displayName: 'Corn Gate Fake',
            api: 'openai-completions',
            baseURL,
            apiKeyEnv: FAKE_KEY_ENV,
            retryPolicy: { mode: 'normal', maxRetries: 0 },
            models: [model(FAKE_MODEL), model(ALT_MODEL)],
          },
        },
      },
    },
    {
      id: 'agent-default-model',
      config: { provider: FAKE_PROVIDER, model: FAKE_MODEL },
    },
  ]
}

const checks = []
const check = (name, facts = {}) => {
  checks.push({ name, passed: true, ...facts })
  console.log(`PASS ${name}`)
}
const ofType = (events, type) =>
  events
    .filter((event) => event.type === type)
    .map((event) => record(event.data))
const sameSelection = (left, right) =>
  left.provider === right.provider &&
  left.model === right.model &&
  left.reasoningEffort === right.reasoningEffort

async function catalogDefault(harness) {
  return record(record(await harness.sessions.modelCatalog()).default)
}

/** One completed Turn: its request header model, switch notices and wire models. */
async function turn(harness, fake, sessionId) {
  const from = fake.requests.length
  const follow = await harness.follow(sessionId)
  try {
    await harness.prompt(sessionId, PROMPT)
    const end = await follow.waitFor(
      (event) => event.type === 'turn/end',
      'turn end',
      TURN_TIMEOUT,
    )
    assert.equal(record(record(end.data).reason).kind, 'completed')
    const headers = ofType(follow.state.events, 'request/header')
    assert.ok(headers.length > 0, 'The Turn must record a request header')
    return {
      model: record(record(headers.at(-1).header).config).model,
      notices: follow.state.events.filter(
        (event) =>
          event.type === 'user/message' &&
          record(record(event.data).source).kind === 'model-selection',
      ).length,
      wireModels: [
        ...new Set(
          fake.requests
            .slice(from)
            .filter((row) => row.kind === 'agent')
            .map((row) => row.model),
        ),
      ],
    }
  } finally {
    follow.cancel()
  }
}

await sandboxDeniesNetwork()
await mkdir(RUN_ROOT, { recursive: true, mode: 0o700 })
const home = join(RUN_ROOT, `session-model-${Date.now()}`)
await mkdir(home, { mode: 0o700 })
await writeFile(
  join(home, '.corn-bot-home.json'),
  `${JSON.stringify({ owner: 'corn-bot', purpose: 'u1-session-model-gate', schemaVersion: 1 })}\n`,
  { mode: 0o600 },
)
const fake = await startFakeModel()
let host
let harness
let passed = false
try {
  await writeFile(
    join(home, 'cordis.patch.yml'),
    `${JSON.stringify(providerPatch(fake.baseURL), null, 2)}\n`,
    { mode: 0o600 },
  )
  await writeFile(join(home, '.env'), `${FAKE_KEY_ENV}=${FAKE_MODEL_KEY}\n`, {
    mode: 0o600,
  })
  const template =
    process.env.CORN_PROFILE_TEMPLATE ?? join(home, 'profile-template')
  if (!existsSync(join(template, 'corn-profile-template.json')))
    await buildProfileTemplate(template)
  host = createGovernedHost(home, {
    model: null,
    profileTemplate: template,
    spawnHost: sandboxedSpawn,
  })
  const route = { route: FAKE_PROVIDER, model: FAKE_MODEL }
  harness = await new ModelHarness(await host.start(), route).connect()
  await harness.assertModelInCatalog()
  const before = await catalogDefault(harness)
  assert.equal(before.provider, FAKE_PROVIDER)
  assert.equal(before.model, FAKE_MODEL)

  const one = await harness.boundSession('u1-one')
  const two = await harness.boundSession('u1-two')
  const first = await turn(harness, fake, one.sessionId)
  assert.equal(first.model, FAKE_MODEL)
  const selected = await harness.sessions.selectSessionModel({
    sessionId: one.sessionId,
    provider: FAKE_PROVIDER,
    model: ALT_MODEL,
  })
  await delay(3_000)
  assert.ok(sameSelection(await catalogDefault(harness), before))
  check('session selection leaves the global default unchanged', {
    default: before.model,
    selected: selected.model,
  })

  const switched = await turn(harness, fake, one.sessionId)
  assert.equal(switched.model, ALT_MODEL)
  assert.deepEqual(switched.wireModels, [ALT_MODEL])
  assert.equal(switched.notices, 1, 'One model switch notice is expected')
  check('request header, wire model and switch notice use the session model', {
    before: first,
    after: switched,
  })

  const other = await turn(harness, fake, two.sessionId)
  assert.equal(other.model, FAKE_MODEL)
  assert.deepEqual(other.wireModels, [FAKE_MODEL])
  assert.equal(other.notices, 0)
  check('another Session keeps its own model', other)

  harness.close()
  await host.stop()
  harness = await new ModelHarness(await host.start(), route).connect()
  const { events } = await harness.page(one.sessionId)
  assert.ok(
    ofType(events, 'model/selection').some((row) => row.model === ALT_MODEL),
  )
  const restored = await turn(harness, fake, one.sessionId)
  assert.equal(restored.model, ALT_MODEL)
  assert.deepEqual(restored.wireModels, [ALT_MODEL])
  assert.equal(restored.notices, 0)
  assert.ok(sameSelection(await catalogDefault(harness), before))
  check('session selection survives a Host restart', restored)

  assert.equal(hostEnvKeys.length, 2, 'Two Host starts are expected')
  for (const keys of hostEnvKeys)
    assert.ok(
      keys.every((key) => HOST_ENV.has(key)),
      `Host env outside the allowlist: ${keys}`,
    )
  check('Host env is the allowlist only', { keys: hostEnvKeys[0] })
  assert.ok(fake.requests.every((row) => row.authOk))
  passed = true
} finally {
  harness?.close()
  await host?.stop()
  await fake.close()
  const report = {
    recordedAt: new Date().toISOString(),
    passed,
    sandbox: 'loopback-only',
    fakeRequests: fake.requests.length,
    checks,
  }
  await mkdir(new URL('../.artifacts/', import.meta.url), {
    recursive: true,
    mode: 0o700,
  })
  await writeFile(
    new URL('../.artifacts/u1-session-model-gate.json', import.meta.url),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  if (passed) await rm(home, { recursive: true, force: true })
  else console.error(`Gate home kept for diagnosis: ${home}`)
}

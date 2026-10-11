import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLAW_COMPONENTS } from '../../apps/desktop/src/runtime/claw-runtime-check.ts'
import { parseReadinessLine } from '../../apps/desktop/src/runtime/host-readiness.ts'
import { acquireProcessLock } from '../../apps/desktop/src/runtime/process-lock.ts'
import {
  CORN_PROFILE,
  claimCornHome,
  cornHostEnvironment,
} from '../../apps/desktop/src/runtime/profile-bootstrap.ts'
import {
  materializeProfile,
  TEMPLATE_MANIFEST,
  verifyTemplate,
} from '../../apps/desktop/src/runtime/profile-template.ts'
import {
  CLAW_VERSION,
  DSH_VERSION,
} from '../../packages/contracts/src/runtime.ts'
import { settleWithin } from './owned-resources.mjs'

export { settleWithin }

const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const require = createRequire(import.meta.url)
export const DSH_MANIFEST = require.resolve('@deepseek-ai/dsh/package.json')
export const DSH_CLI = join(dirname(DSH_MANIFEST), 'lib', 'bin.js')
const MARKER = '.corn-bot-home.json'
const PURPOSE = 'model-config-audit'
const OUTPUT_LIMIT = 4 * 1024 * 1024
const DEFAULT_TIMING = Object.freeze({
  readinessMs: 45_000,
  graceMs: 8_000,
  killMs: 5_000,
  closeMs: 5_000,
})

/** The only key-shaped values an audit may hand to its Host. */
export const FAKE = Object.freeze({
  file: 'sk-corn-auditc-FAKE-0000',
  env: 'sk-corn-auditc-FAKE-ENV-0000',
  dotenv: 'sk-corn-auditc-FAKE-DOTENV-0000',
  discovery: 'sk-corn-auditc-FAKE-DISCOVERY-0000',
})
const FAKE_VALUES = new Set(Object.values(FAKE))

export class AuditRefusal extends Error {}
export class VersionMismatch extends Error {}

/**
 * Audits create their own home. The retired `CORN_DSH_HOME=<home>` form and
 * any unexpected argument are refused from the strings alone, before a file
 * is read, written or a Host spawned.
 */
export function refuseExternalHome(argv, env, { positional = 0 } = {}) {
  if (env.CORN_DSH_HOME !== undefined)
    throw new AuditRefusal(
      'Refusing CORN_DSH_HOME: the audit creates, uses and destroys its own home and never uses an existing one',
    )
  if (argv.length !== positional || argv.some((arg) => arg.startsWith('-')))
    throw new AuditRefusal(
      `Refusing arguments: expected ${positional} positional argument(s) and no home path`,
    )
  return [...argv]
}

/** Corn's allowlisted Host environment plus fake `CORN_AUDIT_*` refs; nothing ambient. */
export function auditHostEnvironment(
  home,
  extra = {},
  { electron = false } = {},
) {
  const environment = cornHostEnvironment(home, null)
  for (const [key, value] of Object.entries(extra)) {
    if (!/^CORN_AUDIT_[A-Z0-9_]+$/u.test(key))
      throw new Error(`Audit Host environment accepts CORN_AUDIT_* refs only`)
    if (!FAKE_VALUES.has(value))
      throw new Error(`Audit Host environment ${key} must carry a fake key`)
    environment[key] = value
  }
  if (electron) environment.ELECTRON_RUN_AS_NODE = '1'
  return environment
}

const TEMPLATE_ENTRIES = new Set([
  'package.json',
  'cordis.yml',
  'cordis.patch.yml',
  'node_modules',
  TEMPLATE_MANIFEST,
])
const CREDENTIAL_NAME = /^\.(env|credentials)/u

/** The template must be the build's profile tree only: no credential store or dotenv layer anywhere. */
export async function assertCredentialFreeTemplate(template) {
  for (const name of await readdir(template))
    if (!TEMPLATE_ENTRIES.has(name))
      throw new Error(
        `Profile template is not credential-free: unexpected ${name}`,
      )
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (CREDENTIAL_NAME.test(entry.name))
        throw new Error(
          `Profile template is not credential-free: ${entry.name} present`,
        )
      if (entry.isDirectory()) await walk(join(directory, entry.name))
    }
  }
  await walk(template)
  await verifyTemplate(template)
}

async function packageVersion(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8')).version ?? null
  } catch {
    return null
  }
}

function expectVersion(label, actual, ...locked) {
  for (const expected of locked)
    if (actual !== expected)
      throw new VersionMismatch(
        `${label} version ${actual ?? 'missing'} differs from the locked ${expected}`,
      )
}

/** Versions read from the packages actually installed, checked against the contract and `runtime.lock.json`. */
export async function verifyRuntimeVersions({
  profile,
  dshManifest = DSH_MANIFEST,
}) {
  const lock = JSON.parse(
    await readFile(join(repo, 'runtime.lock.json'), 'utf8'),
  )
  const dsh = await packageVersion(dshManifest)
  expectVersion('DSH', dsh, DSH_VERSION, lock.dsh.version)
  const modules = join(profile, 'node_modules')
  const claw = await packageVersion(
    join(modules, 'dsh-claw-suite', 'package.json'),
  )
  expectVersion('Claw suite', claw, CLAW_VERSION, lock.claw.version)
  for (const component of CLAW_COMPONENTS)
    expectVersion(
      component,
      await packageVersion(join(modules, component, 'package.json')),
      claw,
    )
  return {
    dsh,
    dshCommit: lock.dsh.commit,
    claw,
    clawComponents: CLAW_COMPONENTS.length,
    clawReleaseSha256: lock.claw.sha256,
  }
}

/** One Host process group; every wait is bounded. */
class AuditHost {
  output = []
  #captured = 0
  #stopFlight

  constructor(child, timing) {
    this.child = child
    this.pid = child.pid
    this.timing = timing
    this.exited = new Promise((resolve) => {
      child.once('exit', () => resolve())
      child.once('close', () => resolve())
      child.once('error', () => {
        if (child.pid === undefined) resolve()
      })
    })
    child.on('error', () => {})
    this.ready = new Promise((resolve, reject) => {
      let pending = ''
      const timer = setTimeout(
        () => reject(new Error('Audit Host readiness deadline exceeded')),
        timing.readinessMs,
      )
      const fail = (error) => {
        clearTimeout(timer)
        reject(error)
      }
      child.once('error', (error) =>
        fail(
          new Error(`Audit Host spawn failed: ${error.code ?? error.message}`),
        ),
      )
      child.once('exit', (code, signal) =>
        fail(
          new Error(`Audit Host exited before readiness (${code ?? signal})`),
        ),
      )
      child.stdout?.setEncoding('utf8').on('data', (chunk) => {
        this.#capture(chunk)
        pending += chunk
        const lines = pending.split(/\r?\n/u)
        pending = lines.pop() ?? ''
        for (const line of lines) {
          try {
            const url = parseReadinessLine(line)
            if (url) {
              clearTimeout(timer)
              resolve(url)
            }
          } catch (error) {
            fail(error)
          }
        }
      })
      child.stderr
        ?.setEncoding('utf8')
        .on('data', (chunk) => this.#capture(chunk))
    })
  }

  #capture(chunk) {
    if (this.#captured >= OUTPUT_LIMIT) return
    this.#captured += chunk.length
    this.output.push(chunk)
  }

  get running() {
    return (
      this.pid !== undefined &&
      this.child.exitCode === null &&
      this.child.signalCode === null
    )
  }

  #groupAlive() {
    if (this.pid === undefined) return false
    try {
      process.kill(-this.pid, 0)
      return true
    } catch {
      return false
    }
  }

  #signal(signal) {
    try {
      process.kill(-this.pid, signal)
    } catch {
      this.child.kill(signal)
    }
  }

  /** SIGTERM, bounded grace, SIGKILL, bounded wait, then reaps the rest of its process group. */
  stop() {
    this.#stopFlight ??= (async () => {
      if (this.running) {
        this.#signal('SIGTERM')
        if (!(await settleWithin(this.exited, this.timing.graceMs)).settled) {
          this.#signal('SIGKILL')
          if (!(await settleWithin(this.exited, this.timing.killMs)).settled)
            throw new Error(`Audit Host ${this.pid} survived SIGKILL`)
        }
      }
      if (this.#groupAlive()) {
        this.#signal('SIGKILL')
        const until = Date.now() + this.timing.killMs
        while (this.#groupAlive() && Date.now() < until)
          await new Promise((resolve) => setTimeout(resolve, 50))
        if (this.#groupAlive())
          throw new Error(`Audit Host ${this.pid} process group survived`)
      }
      this.child.stdout?.destroy()
      this.child.stderr?.destroy()
    })()
    return this.#stopFlight
  }
}

/**
 * A disposable Corn home the audit creates, claims, locks and finally removes.
 * Its path is fixed here; cleanup never takes a path from results or callers.
 */
class AuditLab {
  #hosts = []
  #closers = []
  #release
  #destroyFlight
  #spawnHost

  constructor(root, timing, spawnHost, signal) {
    this.root = root
    this.home = join(root, 'home')
    this.profile = join(this.home, 'profiles', CORN_PROFILE)
    this.labId = randomUUID()
    this.timing = timing
    this.signal = signal
    this.#spawnHost = spawnHost
    signal?.addEventListener(
      'abort',
      () => {
        for (const host of this.#hosts) host.stop().catch(() => {})
      },
      { once: true },
    )
    Object.freeze(this)
  }

  async claim() {
    await mkdir(this.home, { mode: 0o700 })
    await writeFile(
      join(this.home, MARKER),
      `${JSON.stringify({ owner: 'corn-bot', purpose: PURPOSE, labId: this.labId, schemaVersion: 1 })}\n`,
      { flag: 'wx', mode: 0o600 },
    )
    await claimCornHome(this.home)
    this.#release = await acquireProcessLock(this.home)
  }

  /** Seeds the profile once, only from a verified credential-free template. */
  async seedProfile(template) {
    await assertCredentialFreeTemplate(template)
    if (!(await materializeProfile(template, this.profile)))
      throw new Error('Audit profile already exists')
  }

  /** Registers a stub or socket owner closed during destroy. */
  track(close) {
    this.#closers.push(close)
  }

  async startHost({
    command = process.execPath,
    args = [DSH_CLI],
    overlay = [],
    env = {},
    electron = false,
  } = {}) {
    this.signal?.throwIfAborted()
    const patch = join(this.home, 'corn-audit.patch.yml')
    await writeFile(
      patch,
      `${JSON.stringify(
        [
          {
            id: 'workspace-controller',
            config: { documentsDirectory: join(this.home, 'documents') },
          },
          ...overlay,
        ],
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    )
    const child = this.#spawnHost(
      command,
      [...args, CORN_PROFILE, '--patch', patch, '--no-open', '--port', '0'],
      {
        cwd: this.home,
        env: auditHostEnvironment(this.home, env, { electron }),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      },
    )
    const host = new AuditHost(child, this.timing)
    this.#hosts.push(host)
    if (this.signal?.aborted) host.stop().catch(() => {})
    host.launch = await host.ready
    return host
  }

  async #assertOwned() {
    const info = await lstat(this.root)
    if (!info.isDirectory())
      throw new Error('Audit lab root is no longer a directory')
    if (!existsSync(this.home)) return
    const marker = JSON.parse(
      await readFile(join(this.home, MARKER), 'utf8').catch(() => 'null'),
    )
    if (marker?.labId !== this.labId || marker?.purpose !== PURPOSE)
      throw new Error('Audit lab marker changed; refusing to remove the lab')
  }

  /** Stops Hosts, closes stubs, releases the lock, then removes the lab. Throws with `summary` on any failure. */
  destroy() {
    this.#destroyFlight ??= this.#destroy()
    return this.#destroyFlight
  }

  async #destroy() {
    const summary = {
      hostsSpawned: this.#hosts.length,
      hostsStopped: 0,
      stubsClosed: 0,
      lockReleased: false,
      removed: false,
    }
    const errors = []
    const attempt = async (step) => {
      try {
        await step()
      } catch (error) {
        errors.push(error)
      }
    }
    for (const host of this.#hosts)
      await attempt(async () => {
        const live = host.running
        await host.stop()
        if (live) summary.hostsStopped++
      })
    for (const close of this.#closers.toReversed())
      await attempt(async () => {
        const closed = await settleWithin(
          Promise.resolve().then(close),
          this.timing.closeMs,
        )
        if (!closed.settled) throw new Error('Audit stub did not close in time')
        summary.stubsClosed++
      })
    await attempt(async () => {
      await this.#release?.()
      summary.lockReleased = true
    })
    await attempt(async () => {
      await this.#assertOwned()
      await rm(this.root, { recursive: true, force: true, maxRetries: 2 })
      if (existsSync(this.root)) throw new Error('Audit lab still exists')
      summary.removed = true
    })
    if (errors.length > 0)
      throw Object.assign(
        new AggregateError(errors, 'Audit lab cleanup failed'),
        { summary },
      )
    return summary
  }
}

export async function createAuditLab({
  label = 'model',
  parent = tmpdir(),
  timing = {},
  spawnHost = spawn,
  signal,
} = {}) {
  const root = await realpath(
    await mkdtemp(join(parent, `corn-audit-${label}-`)),
  )
  const lab = new AuditLab(
    root,
    { ...DEFAULT_TIMING, ...timing },
    spawnHost,
    signal,
  )
  try {
    await lab.claim()
  } catch (error) {
    await lab.destroy().catch((cleanup) => {
      error.cleanupFailed = cleanup
    })
    throw error
  }
  return lab
}

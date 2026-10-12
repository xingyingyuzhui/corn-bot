import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { cpus, homedir, loadavg } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createGovernedHost } from '../../../apps/desktop/src/runtime/claw-runtime-check.ts'
import { record } from '../../../packages/dsh-adapter/src/remote-error.ts'
import {
  FAKE_KEY_ENV,
  FAKE_MODEL,
  FAKE_MODEL_KEY,
  FAKE_PROVIDER,
} from '../../lib/fake-model-server.mjs'

const run = promisify(execFile)
export const repo = dirname(
  dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
)

/** Every gate home lives here; never `~/.dsh` and never the shared dev home. */
export const GATES_ROOT = join(homedir(), '.corn-bot-dev', 'wt-dsh-gates')
export const TEMPLATE = join(GATES_ROOT, 'template')
export const PURPOSE = 'dsh-headless-gate'
const HOST_MARK = `${sep}dsh${sep}lib${sep}bin.js`
const LOAD_LIMIT = Math.max(4, cpus().length * 0.6)

/** `ps` rows; `cpuSeconds` is cumulative CPU time. */
export async function processTable() {
  const { stdout } = await run(
    'ps',
    ['-A', '-o', 'pid=,ppid=,rss=,time=,command='],
    { maxBuffer: 16 * 1024 * 1024 },
  )
  return stdout
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/u))
    .filter(Boolean)
    .map(([, pid, ppid, rss, time, command]) => ({
      pid: Number(pid),
      ppid: Number(ppid),
      rssKb: Number(rss),
      cpuSeconds: parseCpuTime(time),
      command,
    }))
}

function parseCpuTime(text) {
  const [rest, fraction = '0'] = text.split('.')
  const parts = rest.split(/[:-]/u).map(Number)
  let seconds = 0
  for (const part of parts) seconds = seconds * 60 + part
  return seconds + Number(`0.${fraction}`)
}

/** DSH Host processes of any owner (Corn, audits, other worktrees). */
export async function dshHosts() {
  return (await processTable()).filter((row) => row.command.includes(HOST_MARK))
}

export function descendants(table, rootPid) {
  const out = []
  const queue = [rootPid]
  while (queue.length) {
    const pid = queue.shift()
    const row = table.find((item) => item.pid === pid)
    if (row) out.push(row)
    for (const child of table.filter((item) => item.ppid === pid))
      queue.push(child.pid)
  }
  return out
}

export const SANDBOX_PROFILE = join(repo, 'scripts', 'gates', 'no-network.sb')

/**
 * Spawns under the no-network sandbox (loopback only). `sandbox-exec` execs
 * in place, so the returned pid and its signals belong to the real command.
 * Gate drivers stay outside the sandbox because it refuses setuid `ps`.
 */
const SENSITIVE_ENV = /KEY|TOKEN|SECRET|PASSW|CREDENTIAL|AUTH|COOKIE|PROXY/i

/** Gate children never inherit credentials or proxies from the operator shell. */
export function scrubbedEnv(env = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !SENSITIVE_ENV.test(key)),
  )
}

export function sandboxedSpawn(command, args, options = {}) {
  return spawn('sandbox-exec', ['-f', SANDBOX_PROFILE, command, ...args], {
    ...options,
    env: scrubbedEnv(options.env),
  })
}

/**
 * DSH's bash executor applies its own Seatbelt profile and macOS refuses a
 * nested `sandbox-exec`, so shell-job probes run the Host outside the gate
 * sandbox; isolation is then the loopback-only provider config plus this scrub.
 */
export function unsandboxedSpawn(command, args, options = {}) {
  return spawn(command, args, { ...options, env: scrubbedEnv(options.env) })
}

/**
 * Polls the Host tree's internet sockets; any remote endpoint other than
 * loopback is recorded. Evidence for unsandboxed runs, not a firewall.
 */
export class NetworkWatch {
  samples = 0
  offLoopback = []
  #timer
  #running = false
  #current

  constructor(rootPid) {
    this.rootPid = rootPid
  }

  start() {
    const schedule = () => {
      this.#current = tick()
    }
    const tick = async () => {
      const root = this.rootPid()
      if (root) {
        const pids = descendants(await processTable(), root).map(
          (row) => row.pid,
        )
        // `lsof -p ''` drops the pid filter and lists every socket on the machine.
        if (pids.length === 0) {
          if (this.#running) this.#timer = setTimeout(schedule, 250)
          return
        }
        const { stdout } = await run(
          'lsof',
          ['-nP', '-a', '-p', pids.join(','), '-i'],
          {
            maxBuffer: 4 * 1024 * 1024,
          },
        ).catch((caught) => ({ stdout: caught.stdout ?? '' }))
        this.samples += 1
        for (const line of stdout.split('\n').slice(1)) {
          const remote = line.match(/->(\S+)/)?.[1]
          if (
            remote &&
            !/^(127\.0\.0\.1|\[::1\]|localhost):/.test(remote) &&
            !this.offLoopback.includes(remote)
          )
            this.offLoopback.push(remote)
        }
      }
      if (this.#running) this.#timer = setTimeout(schedule, 250)
    }
    this.#running = true
    schedule()
    return this
  }

  async stop() {
    this.#running = false
    clearTimeout(this.#timer)
    await this.#current
  }
}

/** The sandbox profile the Host runs under refuses a public TCP connect at once. */
export async function assertSandboxDeniesNetwork() {
  const probe = `require('net').connect({host:'1.1.1.1',port:443}).on('connect',()=>{console.log('connected');process.exit(0)}).on('error',e=>{console.log(e.code);process.exit(0)})`
  const child = sandboxedSpawn(process.execPath, ['-e', probe], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  let text = ''
  child.stdout.setEncoding('utf8').on('data', (part) => {
    text += part
  })
  await new Promise((resolve) => child.once('close', resolve))
  assert.equal(
    text.trim(),
    'EPERM',
    'Sandbox profile must deny outbound network',
  )
  return 'EPERM'
}

/** Must run inside `scripts/gates/no-network.sb`: a public TCP connect fails at once. */
export async function assertNetworkDenied() {
  const outcome = await new Promise((resolve) => {
    const socket = connect({ host: '1.1.1.1', port: 443 })
    const timer = setTimeout(() => {
      socket.destroy()
      resolve('timeout')
    }, 3_000)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve('connected')
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      resolve(error.code ?? 'error')
    })
  })
  assert.equal(
    outcome,
    'EPERM',
    `Gate must run under the no-network sandbox (outbound probe: ${outcome})`,
  )
  return outcome
}

/** Refuses to start while another Host runs or the machine is loaded. */
export async function preflight() {
  const load = loadavg()[0]
  if (load > LOAD_LIMIT)
    throw new Error(
      `Load ${load.toFixed(2)} exceeds ${LOAD_LIMIT}; not starting`,
    )
  const hosts = await dshHosts()
  if (hosts.length > 0)
    throw new Error(
      `A DSH Host is already running (pids ${hosts.map((h) => h.pid).join(', ')}); not starting`,
    )
  return { load1: Number(load.toFixed(2)), hostsAlive: 0 }
}

/** Fake provider rows for the home patch layer; Claw rows are untouched. */
export function fakeProviderPatch(baseURL, { contextWindow = 65_536 } = {}) {
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
            models: [
              {
                id: FAKE_MODEL,
                name: 'Corn Gate Model',
                reasoningEfforts: false,
                contextWindow,
                maxTokens: 4_096,
              },
            ],
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

/**
 * Fresh Corn-owned home for one run. The profile is seeded by the supervisor
 * from the verified template; the fake route is a home patch and its key a
 * home `.env` (fake literal only). `homePatch(home)` appends gate-only rows to
 * that home patch, so they pass the same Claw admission as the App's.
 */
export async function createRunHome(
  runName,
  { baseURL, homePatch = () => [], contextWindow } = {},
) {
  await mkdir(GATES_ROOT, { recursive: true, mode: 0o700 })
  const home = join(GATES_ROOT, `${runName}-${Date.now()}`)
  await mkdir(home, { mode: 0o700 })
  await writeFile(
    join(home, '.corn-bot-home.json'),
    `${JSON.stringify({ owner: 'corn-bot', purpose: PURPOSE, run: runName, schemaVersion: 1 })}\n`,
    { mode: 0o600 },
  )
  if (baseURL) {
    await writeFile(
      join(home, 'cordis.patch.yml'),
      `${JSON.stringify([...fakeProviderPatch(baseURL, { contextWindow }), ...homePatch(home)], null, 2)}\n`,
      { mode: 0o600 },
    )
    await writeFile(join(home, '.env'), `${FAKE_KEY_ENV}=${FAKE_MODEL_KEY}\n`, {
      mode: 0o600,
    })
  }
  return home
}

export async function removeRunHome(home) {
  const inside = relative(GATES_ROOT, home)
  assert.ok(inside && !inside.startsWith('..') && !inside.includes(sep))
  const marker = JSON.parse(
    await readFile(join(home, '.corn-bot-home.json'), 'utf8'),
  )
  assert.equal(marker.purpose, PURPOSE)
  await rm(home, { recursive: true, force: true })
}

export function governedHost(home, options = {}) {
  assert.ok(existsSync(join(TEMPLATE, 'corn-profile-template.json')))
  return createGovernedHost(home, {
    model: null,
    profileTemplate: TEMPLATE,
    spawnHost: sandboxedSpawn,
    ...options,
  })
}

/** No process references this home and the Corn lock is released. */
export async function assertHomeReleased(home) {
  const table = await processTable()
  const self = new Set()
  for (let pid = process.pid; pid > 1 && !self.has(pid); ) {
    self.add(pid)
    pid = table.find((row) => row.pid === pid)?.ppid ?? 0
  }
  const leftovers = table.filter(
    (row) => row.command.includes(home) && !self.has(row.pid),
  )
  const lock = existsSync(join(home, 'corn-host.lock'))
  return {
    leftoverProcesses: leftovers.map((row) => ({
      pid: row.pid,
      command: row.command.slice(0, 120),
    })),
    lockHeld: lock,
    ok: leftovers.length === 0 && !lock,
  }
}

/** Samples a Host's process tree: count, RSS and CPU share over each interval. */
export class ResourceSampler {
  constructor(pid, intervalMs = 200) {
    this.pid = pid
    this.intervalMs = intervalMs
    this.samples = []
    this.marks = []
    this.running = false
  }

  start() {
    this.running = true
    this.loop = (async () => {
      let previous
      while (this.running) {
        const table = await processTable()
        const tree = descendants(table, this.pid)
        const now = Date.now()
        const cpu = tree.reduce((sum, row) => sum + row.cpuSeconds, 0)
        const sample = {
          at: now,
          processes: tree.length,
          rssMb: Math.round(tree.reduce((s, r) => s + r.rssKb, 0) / 1024),
          cpuPercent:
            previous && now > previous.at
              ? Math.round(
                  ((cpu - previous.cpu) / ((now - previous.at) / 1000)) * 1000,
                ) / 10
              : undefined,
        }
        previous = { at: now, cpu }
        this.samples.push(sample)
        await delay(this.intervalMs)
      }
    })()
    return this
  }

  /** Exact snapshot of the tree's cumulative CPU, RSS and size at this moment. */
  async mark(label) {
    const tree = descendants(await processTable(), this.pid)
    this.marks.push({
      label,
      at: Date.now(),
      cpu: tree.reduce((sum, row) => sum + row.cpuSeconds, 0),
      rssMb: Math.round(tree.reduce((s, r) => s + r.rssKb, 0) / 1024),
      processes: tree.length,
    })
  }

  async stop() {
    this.running = false
    await this.loop
  }

  /**
   * Between two marks: average CPU from the exact cumulative-CPU delta, and
   * maxima over the periodic samples plus both mark snapshots.
   */
  window(from, to) {
    const a = this.marks.find((m) => m.label === from)
    const b = this.marks.find((m) => m.label === to)
    const start = a?.at ?? 0
    const end = b?.at ?? Infinity
    const rows = [
      ...this.samples.filter((s) => s.at >= start && s.at <= end),
      ...[a, b].filter(Boolean),
    ]
    const cpu = rows.map((s) => s.cpuPercent).filter((v) => v !== undefined)
    return {
      wallMs: a && b ? b.at - a.at : null,
      samples: rows.length,
      processesMax: Math.max(0, ...rows.map((s) => s.processes)),
      rssMbMax: Math.max(0, ...rows.map((s) => s.rssMb)),
      cpuPercentAvg:
        a && b && b.at > a.at
          ? Math.round(((b.cpu - a.cpu) / ((b.at - a.at) / 1000)) * 1000) / 10
          : null,
      cpuPercentSampleMax: cpu.length ? Math.max(...cpu) : null,
    }
  }
}

/** Projections then page through `asOfSeq`: the read-only reconcile (never a follow). */
export async function readOnlyReconcile(transport, sessionId) {
  const projections = record(
    await transport.rpc('session/projections', { request: { sessionId } }),
  )
  assert.equal(typeof projections.asOfSeq, 'number')
  const page = record(
    await transport.rpc('session/page', {
      request: {
        address: { kind: 'session', sessionId },
        throughSeq: projections.asOfSeq,
        maxMessages: 200,
      },
    }),
  )
  const events = (Array.isArray(page.records) ? page.records : [])
    .map(record)
    .map((row) => record(row.event ?? row))
  return { projections, events }
}

/** Current `$events` generation and the approval questions it has seen. */
export function openApprovals(mux) {
  const state = {
    clientId: undefined,
    asked: [],
    withdrawn: new Set(),
    error: undefined,
  }
  const cancel = mux.open(
    '$events',
    {},
    (raw) => {
      const item = record(raw)
      if (item.type === 'ready') state.clientId = item.clientId
      if (item.type === 'waterfall' && item.event === 'approval/request')
        state.asked.push({ ...item, receivedAt: Date.now() })
      if (item.type === 'cancel') state.withdrawn.add(item.eventId)
    },
    (error) => {
      state.error = error
    },
  )
  return { state, cancel }
}

export async function until(read, label, timeoutMs = 20_000, stepMs = 50) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await delay(stepMs)
  }
  throw new Error(`Deadline exceeded: ${label}`)
}

export function eventSummary(event) {
  const data = record(event.data)
  return {
    seq: event.seq,
    type: event.type,
    ...(event.type === 'turn/end'
      ? { turn: data.turn, reason: data.reason }
      : {}),
    ...(event.type === 'turn/start' ? { turn: data.turn } : {}),
    ...(event.type === 'approval/decided' ? { outcome: data.outcome } : {}),
    ...(event.type === 'tool/result'
      ? {
          isError:
            data.message?.isError ??
            data.result?.isError ??
            data.isError ??
            null,
        }
      : {}),
  }
}

export async function writeReport(name, report) {
  const dir = join(repo, '.artifacts', 'gates')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const text = `${JSON.stringify(report, null, 2)}\n`
  assert.ok(
    !text.includes(FAKE_MODEL_KEY),
    'Report must not contain the fake key',
  )
  await writeFile(join(dir, `${name}.json`), text, { mode: 0o600 })
  return join(dir, `${name}.json`)
}

/**
 * Claw delegate only admits background writes (background bash, write-capable
 * subagents) from a git workspace, where it allocates the child's worktree.
 * Turns a disposable Session cwd inside a gate home into a one-commit repo.
 */
export async function gitWorkspace(dir) {
  const inside = relative(GATES_ROOT, dir)
  assert.ok(
    inside && !inside.startsWith('..') && !inside.startsWith(sep),
    'Git workspace must stay inside the gate root',
  )
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  )
  const git = (args) => run('git', args, { cwd: dir, env })
  await git(['init', '-q'])
  await git([
    '-c',
    'user.name=corn-gate',
    '-c',
    'user.email=gate@invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'gate workspace',
  ])
  return dir
}

export async function gitCommit() {
  const { stdout } = await run('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: repo,
  })
  return stdout.trim()
}

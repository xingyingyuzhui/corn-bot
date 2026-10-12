import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { CLAW_VERSION } from '../../../../packages/contracts/src/runtime.ts'
import type { StopTimeouts } from '../../src/runtime/dsh-host-supervisor.ts'
import { HostAuth } from '../../src/runtime/host-auth.ts'
import {
  type AppRuntime,
  type AppRuntimeSeams,
  createAppRuntime,
} from '../../src/runtime/startup-control.ts'

/** Official suite layout (dsh-claw-suite 0.3.0-rc.2 `cordis.patch.yml`). */
export const SUITE_ROWS = [
  'dsh-claw-suite',
  'dsh-claw-policy',
  'dsh-claw-permissions',
  'dsh-claw-observability',
  'dsh-claw-identity',
  'dsh-claw-memory',
  'dsh-claw-gate',
  'dsh-claw-delegate',
  'dsh-claw-registry',
]
export const SUITE_COMPONENTS = [...SUITE_ROWS.slice(1), 'dsh-claw-core']
const WEB_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

export interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}

/** Liveness bound only; ordering is always driven by explicit gates. */
export async function within<T>(
  promise: Promise<T>,
  label: string,
  ms = 2_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} did not settle within ${ms} ms`)),
          ms,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason)
    else signal.addEventListener('abort', () => reject(signal.reason))
  })
}

export class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly pid: number
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
  readonly kills: string[] = []
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  /** Records signals without exiting, like a wedged process. */
  ignoreSignals = false
  #closed = false
  readonly #port: number

  constructor(
    pid: number,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    port: number,
  ) {
    super()
    this.pid = pid
    this.args = args
    this.env = env
    this.#port = port
  }

  ready(): void {
    this.stdout.write(
      `dsh web: http://127.0.0.1:${this.#port}/?token=fixture-token\n`,
    )
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.kills.push(signal)
    if (!this.ignoreSignals) queueMicrotask(() => this.exit(null, signal))
    return true
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitOnly(code, signal)
    if (this.#closed) return
    this.#closed = true
    this.emit('close', this.exitCode, this.signalCode)
  }

  /** Process exit while a descendant still holds the stdio pipes: no `close`. */
  exitOnly(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return
    this.exitCode = code
    this.signalCode = signal
    this.emit('exit', code, signal)
  }
}

export type RegistryMode = 'ok' | 'missing' | 'invalid'

/** How the fake Host answers the Claw Gate audit route (`registerJsonRoute` envelope when mounted). */
export type GateMode =
  | 'ok'
  | 'missing'
  | 'error'
  | 'not-json'
  | 'not-ok'
  | 'no-items'
  | 'items-not-array'
  | 'over-limit'
  | 'hang'

const GATE_ROUTE = '/api/dsh-claw/gate/audit'

function gateAnswer(mode: Exclude<GateMode, 'hang'>): {
  readonly status: number
  readonly type: string
  readonly body: string
} {
  const json = (status: number, value: unknown) => ({
    status,
    type: 'application/json; charset=utf-8',
    body: JSON.stringify(value),
  })
  switch (mode) {
    case 'ok':
      return json(200, { ok: true, items: [] })
    case 'missing':
      return { status: 404, type: 'text/plain', body: 'Not Found' }
    case 'error':
      return json(500, { ok: false, error: 'fixture failure' })
    case 'not-json':
      return { status: 200, type: 'text/html', body: '<html></html>' }
    case 'not-ok':
      return json(200, { ok: false, items: [] })
    case 'no-items':
      return json(200, { ok: true })
    case 'items-not-array':
      return json(200, { ok: true, items: { length: 0 } })
    case 'over-limit':
      return json(200, { ok: true, items: [{}, {}] })
    default: {
      const unreachable: never = mode
      throw new Error(`Unknown Gate mode ${String(unreachable)}`)
    }
  }
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  let text = ''
  for await (const chunk of request) text += String(chunk)
  return text === '' ? undefined : JSON.parse(text)
}

/** Loopback stand-in for the Host's token exchange and Claw Registry and Gate routes. */
export class FakeHost {
  registry: RegistryMode = 'ok'
  gateRegistry = false
  registryCalls = 0
  gate: GateMode = 'ok'
  gateCalls = 0
  readonly gateBodies: unknown[] = []
  readonly #server: Server
  readonly #gates: Array<Deferred<void>> = []
  readonly #arrivals: Array<Deferred<void>> = []
  #arrived = 0
  readonly #gateHolds: Array<Deferred<void>> = []
  readonly #gateArrivals: Array<Deferred<void>> = []
  #gateArrived = 0

  private constructor(server: Server) {
    this.#server = server
  }

  static async start(): Promise<FakeHost> {
    let host: FakeHost | undefined
    const server = createServer((request, response) => {
      void host?.handle(request, response)
    })
    host = new FakeHost(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return host
  }

  get port(): number {
    return (this.#server.address() as AddressInfo).port
  }

  /** Resolves when the next (in call order) Registry request reaches the Host. */
  registryArrived(): Promise<void> {
    const index = this.#arrived++
    this.#arrivals[index] ??= deferred()
    return (this.#arrivals[index] as Deferred<void>).promise
  }

  openRegistry(): void {
    this.#gates.shift()?.resolve()
  }

  /** Resolves when the next (in call order) Gate audit request reaches the Host. */
  gateArrived(): Promise<void> {
    const index = this.#gateArrived++
    this.#gateArrivals[index] ??= deferred()
    return within(
      (this.#gateArrivals[index] as Deferred<void>).promise,
      `Gate audit request #${index + 1}`,
    )
  }

  /** Lets every held (`hang`) Gate request answer as mounted. */
  releaseGate(): void {
    for (const hold of this.#gateHolds.splice(0)) hold.resolve()
  }

  async #handleGate(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const index = this.gateCalls++
    this.gateBodies.push(await readBody(request))
    this.#gateArrivals[index] ??= deferred()
    ;(this.#gateArrivals[index] as Deferred<void>).resolve()
    let mode = this.gate
    if (mode === 'hang') {
      const hold = deferred()
      this.#gateHolds.push(hold)
      await hold.promise
      mode = 'ok'
    }
    const answer = gateAnswer(mode)
    response.writeHead(answer.status, { 'content-type': answer.type })
    response.end(answer.body)
  }

  async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (request.method === 'GET' && request.url === '/?token=fixture-token') {
      response.writeHead(303, {
        location: './',
        'set-cookie': 'dsh-auth-fixture=cookie; HttpOnly; SameSite=Strict',
      })
      response.end()
      return
    }
    if (
      request.method === 'POST' &&
      request.url === '/api/dsh-claw/registry/list' &&
      request.headers.cookie === 'dsh-auth-fixture=cookie'
    ) {
      const index = this.registryCalls++
      this.#arrivals[index] ??= deferred()
      ;(this.#arrivals[index] as Deferred<void>).resolve()
      if (this.gateRegistry) {
        const gate = deferred()
        this.#gates.push(gate)
        await gate.promise
      }
      if (this.registry === 'missing') {
        response.writeHead(404, { 'content-type': 'text/plain' })
        response.end('Not Found')
      } else {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify(
            this.registry === 'ok'
              ? { ok: true, revision: 1, agents: [] }
              : { ok: true, revision: 'not-a-revision' },
          ),
        )
      }
      return
    }
    if (
      request.method === 'POST' &&
      request.url === GATE_ROUTE &&
      request.headers.cookie === 'dsh-auth-fixture=cookie'
    ) {
      await this.#handleGate(request, response)
      return
    }
    response.writeHead(404)
    response.end()
  }

  async close(): Promise<void> {
    for (const gate of this.#gates.splice(0)) gate.resolve()
    this.releaseGate()
    this.#server.closeAllConnections()
    await new Promise<void>((resolve) => this.#server.close(() => resolve()))
  }
}

export interface ClawProfileOptions {
  readonly suiteVersion?: string
  readonly componentVersions?: Readonly<Record<string, string>>
  readonly omit?: readonly string[]
  readonly bundles?: readonly string[]
  readonly profilePatch?: string
  readonly suitePatch?: string
  /** A profile-local bundle package listed after the suite, with this patch layer. */
  readonly extraBundle?: { readonly name: string; readonly patch: string }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

/** A profile shaped like Corn's installed `corn-dev` profile, without plugin code. */
export async function writeClawProfile(
  profile: string,
  options: ClawProfileOptions = {},
): Promise<void> {
  const modules = join(profile, 'node_modules')
  await mkdir(modules, { recursive: true })
  const extra = options.extraBundle
  await writeJson(join(profile, 'package.json'), {
    name: 'dsh-profile-corn-dev',
    private: true,
    dependencies: { 'dsh-claw-suite': CLAW_VERSION },
    dsh: {
      profile: {
        bundles: options.bundles ?? [
          ...WEB_BUNDLES,
          'dsh-claw-suite',
          ...(extra ? [extra.name] : []),
        ],
      },
    },
  })
  if (extra) {
    await mkdir(join(modules, extra.name), { recursive: true })
    await writeJson(join(modules, extra.name, 'package.json'), {
      name: extra.name,
      version: '1.0.0',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })
    await writeFile(join(modules, extra.name, 'cordis.patch.yml'), extra.patch)
  }
  await writeFile(
    join(profile, 'cordis.patch.yml'),
    options.profilePatch ?? '[]\n',
  )
  const omit = new Set(options.omit ?? [])
  if (!omit.has('dsh-claw-suite')) {
    const suite = join(modules, 'dsh-claw-suite')
    await mkdir(suite, { recursive: true })
    await writeJson(join(suite, 'package.json'), {
      name: 'dsh-claw-suite',
      version: options.suiteVersion ?? CLAW_VERSION,
      type: 'module',
      main: './host.js',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })
    await writeFile(
      join(suite, 'cordis.patch.yml'),
      options.suitePatch ??
        `- insert:\n${SUITE_ROWS.map((id) => `    - id: ${id}\n      name: ${id}\n`).join('')}`,
    )
  }
  for (const name of SUITE_COMPONENTS) {
    if (omit.has(name)) continue
    await mkdir(join(modules, name), { recursive: true })
    await writeJson(join(modules, name, 'package.json'), {
      name,
      version: options.componentVersions?.[name] ?? CLAW_VERSION,
    })
  }
}

export async function writeWebProfile(profile: string): Promise<void> {
  await mkdir(profile, { recursive: true })
  await writeJson(join(profile, 'package.json'), {
    name: 'dsh-profile-corn-dev',
    private: true,
    dsh: { profile: { bundles: WEB_BUNDLES } },
  })
  await writeFile(join(profile, 'cordis.patch.yml'), '[]\n')
}

export interface HarnessOptions {
  readonly profile?: 'claw' | 'web' | 'none'
  readonly claw?: ClawProfileOptions
  /** Explicit development override file contents; absent means the App's default keyless start. */
  readonly devOverride?: string
  readonly devOverrideMode?: number
  readonly autoReady?: boolean
  readonly gateExchange?: boolean
  readonly profileTemplate?: string
  /** Every spawned child ignores SIGTERM and SIGKILL. */
  readonly wedgedChildren?: boolean
  readonly stopTimeouts?: StopTimeouts
}

interface ScheduledRecovery {
  readonly run: () => void
  readonly delayMs: number
  cancelled: boolean
}

interface Exchange {
  readonly signal: AbortSignal
  readonly gate: Deferred<void>
}

/** The App's real startup control and supervisor with only process, auth timing and timers faked. */
export class RuntimeHarness {
  readonly root: string
  readonly home: string
  readonly profile: string
  readonly devOverrideFile: string
  readonly host: FakeHost
  readonly children: FakeChild[] = []
  readonly schedules: ScheduledRecovery[] = []
  readonly exchanges: Exchange[] = []
  runtime!: AppRuntime
  readonly #options: HarnessOptions
  readonly #childArrivals: Array<Deferred<FakeChild>> = []
  readonly #exchangeArrivals: Array<Deferred<Exchange>> = []
  #childrenAwaited = 0
  #exchangesAwaited = 0

  private constructor(root: string, host: FakeHost, options: HarnessOptions) {
    this.root = root
    this.home = join(root, 'dsh')
    this.profile = join(this.home, 'profiles', 'corn-dev')
    this.devOverrideFile = join(root, 'model.env')
    this.host = host
    this.#options = options
  }

  static async create(options: HarnessOptions = {}): Promise<RuntimeHarness> {
    const root = await mkdtemp(join(tmpdir(), 'corn-startup-test-'))
    const harness = new RuntimeHarness(root, await FakeHost.start(), options)
    await harness.#prepare()
    return harness
  }

  async #prepare(): Promise<void> {
    const options = this.#options
    await mkdir(this.home, { recursive: true, mode: 0o700 })
    await writeJson(join(this.home, '.corn-bot-home.json'), {
      owner: 'corn-bot',
      schemaVersion: 1,
    })
    const profile = options.profile ?? 'claw'
    if (profile === 'claw') await writeClawProfile(this.profile, options.claw)
    else if (profile === 'web') await writeWebProfile(this.profile)
    if (options.devOverride !== undefined) {
      await writeFile(this.devOverrideFile, options.devOverride, {
        mode: 0o600,
      })
      await chmod(this.devOverrideFile, options.devOverrideMode ?? 0o600)
    }
    this.runtime = this.build()
  }

  /** Builds the App runtime exactly as Main does, with faked process seams. */
  build(): AppRuntime {
    return createAppRuntime(
      {
        home: this.home,
        devModelOverrideFile:
          this.#options.devOverride === undefined
            ? undefined
            : this.devOverrideFile,
        profileTemplate: this.#options.profileTemplate,
      },
      this.seams(),
    )
  }

  /** The faked process, auth and timer seams `build` hands to the App runtime. */
  seams(): Required<Omit<AppRuntimeSeams, 'stopTimeouts'>> & AppRuntimeSeams {
    return {
      spawnHost: (_command, args, options: SpawnOptions) => {
        const child = new FakeChild(
          40_000 + this.children.length,
          args,
          options.env ?? {},
          this.host.port,
        )
        child.ignoreSignals = this.#options.wedgedChildren === true
        const index = this.children.length
        this.children.push(child)
        this.#childArrivals[index] ??= deferred()
        ;(this.#childArrivals[index] as Deferred<FakeChild>).resolve(child)
        if (this.#options.autoReady !== false)
          queueMicrotask(() => child.ready())
        return child as unknown as ChildProcess
      },
      exchangeAuth: async (launch, signal) => {
        const exchange = { signal, gate: deferred() }
        const index = this.exchanges.length
        this.exchanges.push(exchange)
        this.#exchangeArrivals[index] ??= deferred()
        ;(this.#exchangeArrivals[index] as Deferred<Exchange>).resolve(exchange)
        if (this.#options.gateExchange)
          await Promise.race([exchange.gate.promise, aborted(signal)])
        return HostAuth.exchange(launch, signal)
      },
      ...(this.#options.stopTimeouts
        ? { stopTimeouts: this.#options.stopTimeouts }
        : {}),
      schedule: (run, delayMs) => {
        const entry = { run, delayMs, cancelled: false }
        this.schedules.push(entry)
        return () => {
          entry.cancelled = true
        }
      },
    }
  }

  get control(): AppRuntime['control'] {
    return this.runtime.control
  }

  /** The next spawned child, in spawn order. */
  nextChild(): Promise<FakeChild> {
    const index = this.#childrenAwaited++
    this.#childArrivals[index] ??= deferred()
    return within(
      (this.#childArrivals[index] as Deferred<FakeChild>).promise,
      `spawn #${index + 1}`,
    )
  }

  /** The next launch-token exchange, in call order. */
  nextExchange(): Promise<Exchange> {
    const index = this.#exchangesAwaited++
    this.#exchangeArrivals[index] ??= deferred()
    return within(
      (this.#exchangeArrivals[index] as Deferred<Exchange>).promise,
      `exchange #${index + 1}`,
    )
  }

  /** Runs the single pending recovery timer. */
  runRecovery(): void {
    const pending = this.schedules.filter((entry) => !entry.cancelled)
    const entry = pending.at(-1)
    if (!entry) throw new Error('No recovery is scheduled')
    entry.cancelled = true
    entry.run()
  }

  async dispose(): Promise<void> {
    await this.runtime.control.shutdown().catch(() => {})
    await this.host.close()
    await rm(this.root, { recursive: true, force: true })
  }
}
